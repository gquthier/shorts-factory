import { fontFile, hookPreview } from './lib/hook-preview.ts';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { z } from 'zod';
import { DATA, loadConfig, ROOT, SOURCE_KINDS, type SourceKind } from './lib/config.ts';
import { db } from './lib/db.ts';
import { enqueue } from './lib/jobs.ts';
import { log } from './lib/log.ts';
import { addSource, exportApproved, importMetrics } from './lib/sources.ts';
import { listTemplates } from './lib/templates.ts';
import { getSetting, setSetting } from './lib/db.ts';
import { freshness } from './lib/freshness.ts';
import { createTryPostClient, TRYPOST_API, TryPostError } from './lib/trypost.ts';
import { deleteSecret, getSecret, setSecret } from './lib/secrets.ts';
import { AUTOPILOT_DEFAULTS, autopilotStatus, autopilotTick, rateClip, restartVolumeGrowth } from './stages/autopilot.ts';
import { cancelPublication, planAndBook, routing, setRoute, statsSummary, syncChannels, TRYPOST_SECRET, tryPostBaseUrl } from './stages/publish.ts';
import { startWorker } from './worker.ts';
import { readPerformance } from './lib/performance-db.ts';
import { PerformanceFilters, performanceBrief, TOPICS } from './lib/performance.ts';
import { setupStatus } from './lib/setup.ts';
import { readProfile, saveProfile } from './lib/profile.ts';
import { connectService, disconnectService, ServiceId } from './lib/connections.ts';

const PORT = Number(process.env.PORT ?? 4783);
const ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);
const MAX_JSON = 2_000_000;

const send = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const readJson = (req: http.IncomingMessage): Promise<unknown> => new Promise((resolve, reject) => {
  const chunks: Buffer[] = [];
  let size = 0;
  req.on('data', (d: Buffer) => { size += d.length; if (size > MAX_JSON) { reject(new Error('Body too large')); req.destroy(); } else chunks.push(d); });
  req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { reject(new Error('Invalid JSON')); } });
  req.on('error', reject);
});

const flag = z.enum(['0', '1']);
const SettingsSchema = z.object({
  autopilot: flag, auto_approve_when_empty: flag, auto_approve_allow_warn: flag, post_as_draft: flag, create_new: flag, text_hook: flag, cold_open: flag, caption_unique: flag, caption_text: z.string().trim().min(1).max(2200),
  auto_approve_min_score: z.coerce.number().int().min(0).max(100),
  volume_start: z.coerce.number().int().min(0).max(200), volume_step: z.coerce.number().int().min(0).max(50), volume_every_days: z.coerce.number().int().min(1).max(60), volume_max: z.coerce.number().int().min(1).max(200),
  post_start_hour: z.coerce.number().int().min(0).max(23), post_end_hour: z.coerce.number().int().min(0).max(23), post_min_gap_hours: z.coerce.number().min(0.25).max(24),
}).partial();
const ChannelSchema = z.object({ enabled: z.boolean().optional(), maxPerDay: z.number().int().min(1).max(200).optional(), volume: z.object({ start: z.number().int().min(1).max(200), step: z.number().int().min(0).max(50), every: z.number().int().min(1).max(60) }).nullable().optional() });
const RouteSchema = z.object({ template: z.string().regex(/^[a-z0-9-]+$/), channelId: z.string().min(1).max(100), allowed: z.boolean() });
const KeySchema = z.object({ apiKey: z.string().min(8).max(4000), baseUrl: z.string().url().optional() });
const IdeaSchema = z.object({ status: z.enum(['new', 'keep', 'filmed', 'dropped']) });

const settings = () => ({
  ...Object.fromEntries(Object.entries(AUTOPILOT_DEFAULTS).map(([k, d]) => [k, getSetting(k, d)])),
  trypost_configured: Boolean(getSecret(TRYPOST_SECRET)),   // never the key itself
  trypost_base_url: tryPostBaseUrl(),
});

function readOutliers(): unknown[] {
  const files = ['research/03-outliers/outliers.json', 'research/04-hooks-fr/outliers.json'];
  return files.flatMap(file => { const f = path.join(DATA, file); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) as unknown[] : []; });
}

const freshnessOf = (c: Record<string, unknown>) => {
  const f = freshness(`${String(c.hook ?? '')} ${String(c.transcript ?? '')}`, c.shelf_life as string | null, c.published_at as string | null, new Date());
  return { stale: f.stale, age_days: f.age, shelf: f.shelf };
};

const state = () => {
  const clips = (db.prepare(`SELECT c.id, c.source_id, c.start, c.end, c.category, c.title, c.why, c.standalone, c.hook, c.hook_type, c.hook_score, c.hooks, c.caption, c.text_hook, c.cold_open, c.value_score, c.takeaway, c.template, c.status, c.error, c.question, c.qa, c.qa_status, c.viral, c.viral_why, c.approved_by, s.path IS NOT NULL uploaded, c.transcript, c.shelf_life, s.published_at, s.title source_title, s.kind
    FROM clips c JOIN sources s ON s.id = c.source_id ORDER BY (c.status = 'review') DESC, c.viral DESC, c.hook_score DESC LIMIT 1000`).all() as Record<string, unknown>[])
    .map((c) => ({ ...c, hooks: JSON.parse(String(c.hooks ?? '[]')) as unknown, qa: c.qa ? JSON.parse(String(c.qa)) as unknown : null, viral_why: c.viral_why ? JSON.parse(String(c.viral_why)) as unknown : [], transcript: undefined, ...freshnessOf(c) }))
    .sort((x, y) => { const a = x as unknown as Record<string, number | string | boolean | null>; const b = y as unknown as Record<string, number | string | boolean | null>; return Number(a.status !== 'review') - Number(b.status !== 'review') || Number(a.stale) - Number(b.stale) || Number(b.viral ?? 0) - Number(a.viral ?? 0); });
  return {
    settings: settings(),
    autopilot: autopilotStatus(),
    routing: routing(),
    setup_complete: !!readProfile(DATA),
    channels: db.prepare('SELECT id, name, provider, profile, picture, enabled, disabled_upstream, max_per_day, vol_start, vol_step, vol_every, vol_since, synced_at FROM channels ORDER BY provider, name').all(),
    publications: db.prepare(`SELECT p.id, p.clip_id, p.channel_id, p.state, p.scheduled_at, p.release_url, p.error, c.hook, ch.name channel, ch.provider
      FROM publications p JOIN clips c ON c.id = p.clip_id JOIN channels ch ON ch.id = p.channel_id WHERE p.state != 'cancelled' ORDER BY p.scheduled_at LIMIT 300`).all(),
    ideas: (db.prepare("SELECT * FROM ideas WHERE status != 'dropped' ORDER BY created_at DESC LIMIT 100").all() as Record<string, unknown>[])
      .map((i) => ({ ...i, hooks: JSON.parse(String(i.hooks ?? '[]')) as unknown, proof_needed: JSON.parse(String(i.proof_needed ?? '[]')) as unknown, inspired_by: JSON.parse(String(i.inspired_by ?? '[]')) as unknown })),
    sources: db.prepare('SELECT id, kind, title, status, duration, error, created_at FROM sources ORDER BY created_at DESC LIMIT 100').all(),
    clips,
    jobs: db.prepare('SELECT type, status, COUNT(*) n FROM jobs GROUP BY type, status').all(),
    running: db.prepare("SELECT type, ref FROM jobs WHERE status = 'running'").all(),
    templates: listTemplates(),
    target: loadConfig().targets.clipsPerDay,
    accounts: loadConfig().accounts,
    today: db.prepare("SELECT COUNT(*) n FROM clips WHERE date(created_at) = date('now') AND status IN ('review','approved','exported')").get(),
  };
};

const ClipAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('topic'), topic: z.string().nullable().refine(v => v === null || TOPICS.includes(v)) }),
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('reject') }),
  z.object({ action: z.literal('caption'), caption: z.string().min(1).max(2200) }),
  z.object({ action: z.literal('reopen') }),
  z.object({ action: z.literal('rerender'), hook: z.string().min(3).max(160).optional(), template: z.string().regex(/^[a-z0-9-]+$/).optional(), question: z.string().max(200).optional(), textHook: z.boolean().optional(), approve: z.boolean().optional() }),
]);

function applyClipAction(id: string, raw: unknown) {
  const a = ClipAction.parse(raw);
  const exists = db.prepare('SELECT id FROM clips WHERE id = ?').get(id);
  if (!exists) throw new Error('Unknown clip');
  if (a.action === 'topic') db.prepare('UPDATE clips SET performance_topic = ? WHERE id = ?').run(a.topic, id);
  if (a.action === 'approve') {
    db.prepare("UPDATE clips SET status = 'approved', approved_by = 'manual', reviewed_at = datetime('now') WHERE id = ?").run(id);
    void autopilotTick();
  }
  if (a.action === 'reject') db.prepare("UPDATE clips SET status = 'rejected', approved_by = NULL, reviewed_at = datetime('now') WHERE id = ?").run(id);
  if (a.action === 'caption') db.prepare('UPDATE clips SET caption = ? WHERE id = ?').run(a.caption, id);
  if (a.action === 'reopen') db.prepare("UPDATE clips SET status = 'review', approved_by = NULL WHERE id = ?").run(id);
  if (a.action === 'rerender') {
    if (a.template && !listTemplates().includes(a.template)) throw new Error('Unknown template');
    if (a.textHook !== undefined) db.prepare('UPDATE clips SET text_hook = ? WHERE id = ?').run(a.textHook ? 1 : 0, id);
    // Validated with a new hook: it comes back validated once remade, and stays out of the planner until then.
    if (a.approve) db.prepare("UPDATE clips SET approved_by = 'manual', reviewed_at = datetime('now') WHERE id = ?").run(id);
    db.prepare("UPDATE clips SET hook = COALESCE(?, hook), template = COALESCE(?, template), question = COALESCE(?, question), status = 'hooked' WHERE id = ?").run(a.hook ?? null, a.template ?? null, a.question ?? null, id);
    enqueue('render', id, 15);
  }
}

/** Streams an upload to disk: masterclass files run to many gigabytes. */
function handleUpload(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const kind = z.enum(SOURCE_KINDS).parse(url.searchParams.get('kind')) as SourceKind;
  if (url.searchParams.get('rights') !== '1') throw new Error('Confirme que tu as les droits sur cette vidéo');
  const name = path.basename(url.searchParams.get('name') ?? 'upload.mp4').replace(/[^\w.-]/g, '_').slice(-80);
  if (!/\.(mp4|mov|m4v|mkv|webm)$/i.test(name)) throw new Error('Format vidéo non supporté');
  const dir = path.join(DATA, 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${crypto.randomBytes(6).toString('hex')}-${name}`);
  const out = fs.createWriteStream(file);
  req.pipe(out);
  out.on('finish', () => {
    const id = addSource({ kind, path: file, title: url.searchParams.get('title') ?? name.replace(/\.\w+$/, ''), rightsConfirmed: true });
    send(res, 200, { success: true, data: { id } });
  });
  out.on('error', () => send(res, 500, { success: false, error: "Échec de l'écriture du fichier" }));
}

function serveFile(req: http.IncomingMessage, res: http.ServerResponse, file: string, type: string) {
  if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
  const size = fs.statSync(file).size;
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
  if (m) {
    const start = Number(m[1]);
    const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': size });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
    if (!ORIGINS.has(`http://${req.headers.host}`)) return send(res, 403, { success: false, error: 'Host refused' });
    // Local app with no login: refuse cross-site writes so a web page cannot drive it.
    if (req.method !== 'GET' && !ORIGINS.has(req.headers.origin ?? '')) return send(res, 403, { success: false, error: 'Origin refused' });
    if (req.method === 'GET' && url.pathname === '/') return serveFile(req, res, path.join(ROOT, 'ui/index.html'), 'text/html; charset=utf-8');
    if (req.method === 'GET' && url.pathname === '/api/state') return send(res, 200, { success: true, data: state() });
    if (req.method === 'GET' && url.pathname === '/api/setup') return send(res, 200, { success: true, data: setupStatus() });
    if (req.method === 'POST' && url.pathname === '/api/setup/profile') return send(res, 200, { success: true, data: saveProfile(DATA, await readJson(req)) });
    if (req.method === 'POST' && url.pathname === '/api/setup/connection') {
      const input = z.object({ service: ServiceId, apiKey: z.string().min(8).max(4000) }).parse(await readJson(req));
      const result = await connectService(input.service, input.apiKey);
      if (input.service === 'anthropic') { setSetting('llm_provider', 'anthropic'); if (result.models?.length) setSetting('anthropic_model', result.models.find(m => m.includes('sonnet')) ?? result.models[0]!); }
      if (input.service === 'trypost') { setSetting('trypost_base_url', TRYPOST_API); await syncChannels(); }
      return send(res, 200, { success: true, data: result });
    }
    const connection = /^\/api\/setup\/connection\/([a-z]+)$/.exec(url.pathname);
    if (req.method === 'DELETE' && connection) { disconnectService(connection[1]!); return send(res, 200, { success: true }); }
    if (req.method === 'POST' && url.pathname === '/api/setup/llm') {
      const input = z.object({ provider: z.enum(['claude-cli', 'anthropic']), model: z.string().regex(/^claude-[a-z0-9.-]+$/).max(100).optional() }).parse(await readJson(req));
      if (input.provider === 'anthropic' && !getSecret('SHORTS_FACTORY_ANTHROPIC')) return send(res, 400, { success: false, error: 'Connecte une clé Anthropic avant de choisir ce mode.' });
      setSetting('llm_provider', input.provider);
      if (input.model) setSetting('anthropic_model', input.model);
      return send(res, 200, { success: true });
    }
    if (req.method === 'GET' && url.pathname.startsWith('/ui/')) {
      // Static files of the interface only: the resolved path must stay inside ui/.
      const file = path.resolve(ROOT, 'ui', url.pathname.slice(4));
      const types: Record<string, string> = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
      const type = types[path.extname(file)];
      if (!type || !file.startsWith(`${path.join(ROOT, 'ui')}${path.sep}`)) return send(res, 404, { success: false, error: 'Not found' });
      return serveFile(req, res, file, type);
    }
    const font = /^\/fonts\/([\w.-]+)$/.exec(url.pathname);
    if (req.method === 'GET' && font) { const file = fontFile(font[1]!); if (!file) return send(res, 404, { success: false, error: 'Police inconnue' }); return serveFile(req, res, file, 'font/ttf'); }
    const preview = /^\/api\/clips\/([\w-]+)\/hook-preview$/.exec(url.pathname);
    if (req.method === 'GET' && preview) {
      const clip = db.prepare('SELECT id, template, question FROM clips WHERE id = ?').get(preview[1]!) as { id: string; template: string | null; question: string | null } | undefined;
      if (!clip?.template) return send(res, 404, { success: false, error: 'Clip inconnu' });
      const text = z.string().max(200).parse(url.searchParams.get('hook') ?? '');
      const html = await hookPreview({ id: clip.id, template: clip.template, question: clip.question }, text, loadConfig().creator, url.searchParams.get('layer') === '1');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(html);
      return;
    }
    const media = /^\/media\/([\w-]+)\/(final\.mp4|poster\.jpg|clean\.jpg)$/.exec(url.pathname);
    if (req.method === 'GET' && media) return serveFile(req, res, path.join(DATA, 'clips', media[1]!, media[2]!), media[2] === 'final.mp4' ? 'video/mp4' : 'image/jpeg');
    if (req.method === 'POST' && url.pathname === '/api/sources') return send(res, 200, { success: true, data: { id: addSource(await readJson(req) as Parameters<typeof addSource>[0]) } });
    if (req.method === 'POST' && url.pathname === '/api/upload') return handleUpload(req, res, url);
    if (req.method === 'POST' && url.pathname === '/api/export') return send(res, 200, { success: true, data: await exportApproved(new Date().toLocaleDateString('sv-SE')) });
    if (req.method === 'POST' && url.pathname === '/api/metrics') return send(res, 200, { success: true, data: { imported: importMetrics(await readJson(req) as unknown[]) } });
    if (req.method === 'GET' && url.pathname === '/api/stats') return send(res, 200, { success: true, data: statsSummary() });
    if (req.method === 'GET' && url.pathname === '/api/performance') return send(res, 200, { success: true, data: readPerformance(db, PerformanceFilters.parse(Object.fromEntries(url.searchParams))) });
    if (req.method === 'GET' && url.pathname === '/api/outliers') return send(res, 200, { success: true, data: readOutliers() });
    if (req.method === 'POST' && url.pathname === '/api/settings') {
      const parsed = SettingsSchema.parse(await readJson(req));
      for (const [k, v] of Object.entries(parsed)) setSetting(k, String(v));
      if (parsed.volume_start !== undefined || parsed.volume_step !== undefined || parsed.volume_every_days !== undefined) restartVolumeGrowth();
      void autopilotTick();
      return send(res, 200, { success: true, data: settings() });
    }
    if (req.method === 'POST' && url.pathname === '/api/trypost/key') {
      const { apiKey, baseUrl } = KeySchema.parse(await readJson(req));
      try {
        // Verify before saving: a wrong key should fail here, not at publication time.
        const n = (await createTryPostClient({ apiKey, baseUrl: baseUrl ?? TRYPOST_API, retries: 1 }).listAccounts()).length;
        setSecret(TRYPOST_SECRET, apiKey);
        setSetting('trypost_base_url', baseUrl ?? TRYPOST_API);
        return send(res, 200, { success: true, data: { integrations: n, channels: await syncChannels() } });
      } catch (error) {
        throw new Error(error instanceof TryPostError && error.status === 401 ? 'Clé TryPost refusée' : `Connexion à TryPost impossible : ${error instanceof Error ? error.message.slice(0, 200) : ''}`);
      }
    }
    if (req.method === 'DELETE' && url.pathname === '/api/trypost/key') { deleteSecret(TRYPOST_SECRET); return send(res, 200, { success: true }); }
    if (req.method === 'POST' && url.pathname === '/api/channels/sync') return send(res, 200, { success: true, data: { channels: await syncChannels() } });
    if (req.method === 'POST' && url.pathname === '/api/routing') {
      const r = RouteSchema.parse(await readJson(req));
      setRoute(r.template, r.channelId, r.allowed);
      return send(res, 200, { success: true, data: routing() });
    }
    const chan = /^\/api\/channels\/([\w-]+)$/.exec(url.pathname);
    if (req.method === 'POST' && chan) {
      const c = ChannelSchema.parse(await readJson(req));
      db.prepare('UPDATE channels SET enabled = COALESCE(?, enabled), max_per_day = COALESCE(?, max_per_day) WHERE id = ?').run(c.enabled === undefined ? null : Number(c.enabled), c.maxPerDay ?? null, chan[1]!);
      // Its own growth starts today; null goes back to the general volume.
      if (c.volume !== undefined) db.prepare('UPDATE channels SET vol_start = ?, vol_step = ?, vol_every = ?, vol_since = ? WHERE id = ?').run(c.volume?.start ?? null, c.volume?.step ?? null, c.volume?.every ?? null, c.volume ? new Date().toLocaleDateString('sv-SE') : null, chan[1]!);
      return send(res, 200, { success: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/schedule') return send(res, 200, { success: true, data: { planned: planAndBook() } });
    if (req.method === 'POST' && url.pathname === '/api/autopilot/run') return send(res, 200, { success: true, data: await autopilotTick() });
    if (req.method === 'POST' && url.pathname === '/api/sync') { enqueue('sync', 'trypost'); return send(res, 200, { success: true }); }
    const cancel = /^\/api\/publications\/([\w-]+)\/cancel$/.exec(url.pathname);
    if (req.method === 'POST' && cancel) { await cancelPublication(cancel[1]!); return send(res, 200, { success: true }); }
    if (req.method === 'POST' && url.pathname === '/api/ideas/generate') {
      const { count, performance } = z.object({ count: z.number().int().min(1).max(20).default(10), performance: PerformanceFilters.optional() }).parse(await readJson(req));
      const ref = `${count}:${Date.now()}:${crypto.randomBytes(3).toString('hex')}`;
      if (performance) {
        const summary = readPerformance(db, performance);
        if (!summary.totals[performance.metric].covered) throw new Error('Aucune donnée disponible pour cette métrique et ces filtres.');
        db.prepare('INSERT INTO idea_briefs (job_ref, content) VALUES (?,?)').run(ref, performanceBrief(summary));
      }
      enqueue('ideas', ref);
      return send(res, 200, { success: true });
    }
    const idea = /^\/api\/ideas\/([\w-]+)$/.exec(url.pathname);
    if (req.method === 'POST' && idea) { db.prepare('UPDATE ideas SET status = ? WHERE id = ?').run(IdeaSchema.parse(await readJson(req)).status, idea[1]!); return send(res, 200, { success: true }); }
    const clip = /^\/api\/clips\/([\w-]+)$/.exec(url.pathname);
    if (req.method === 'POST' && clip) { applyClipAction(clip[1]!, await readJson(req)); return send(res, 200, { success: true }); }
    return send(res, 404, { success: false, error: 'Not found' });
  })().catch((error: unknown) => {
    const message = error instanceof z.ZodError ? (error.issues[0]?.message ?? 'Données invalides') : error instanceof Error ? error.message : 'Erreur';
    log.error({ name: 'server.request', path: req.url, error: message }, 'Request failed');
    if (!res.headersSent) send(res, 400, { success: false, error: message });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  log.info({ name: 'server.start', port: PORT }, 'Factory running');
  for (const { id } of db.prepare('SELECT id FROM clips WHERE qa IS NOT NULL AND viral IS NULL').all() as { id: string }[]) rateClip(id);
  if (process.env.SHORTS_NO_WORKER !== '1') startWorker();
});
