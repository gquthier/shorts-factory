import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { channelVolume, DEFAULT_CAPTION, priority, volumeOn, type ChannelVolumeRow, type VolumeSettings } from '../lib/autopilot.ts';
import { db, getSetting, setSetting } from '../lib/db.ts';
import { freshness } from '../lib/freshness.ts';
import { enqueue, Retry } from '../lib/jobs.ts';
import { log } from '../lib/log.ts';
import { planPublications, type PlanChannel } from '../lib/planner.ts';
import { createTryPostClient, publicationState, SUPPORTED_PLATFORMS, TRYPOST_API, type TryPostClient } from '../lib/trypost.ts';
import { getSecret } from '../lib/secrets.ts';
import { run } from '../lib/sh.ts';

export const TRYPOST_SECRET = process.env.SHORTS_TRYPOST_SERVICE ?? 'SHORTS_FACTORY_TRYPOST';
const CHECKS_PER_RUN = 40;   // TryPost allows 60 requests per minute

export const tryPostBaseUrl = () => getSetting('trypost_base_url', TRYPOST_API);

export function tryPostClient(): TryPostClient | null {
  const apiKey = getSecret(TRYPOST_SECRET);
  return apiKey ? createTryPostClient({ apiKey, baseUrl: tryPostBaseUrl() }) : null;
}

const requireClient = (): TryPostClient => {
  const c = tryPostClient();
  if (!c) throw new Error('Clé TryPost manquante : ajoute-la dans Comptes');
  return c;
};

/** Mirrors the accounts connected in TryPost. A new channel starts disabled: nothing publishes until it is switched on. */
export async function syncChannels(): Promise<number> {
  const list = (await requireClient().listAccounts()).filter((a) => SUPPORTED_PLATFORMS.includes(a.platform));
  const up = db.prepare(`INSERT INTO channels (id, name, provider, profile, picture, disabled_upstream, max_per_day, synced_at) VALUES (?,?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, provider = excluded.provider, profile = excluded.profile, picture = excluded.picture, disabled_upstream = excluded.disabled_upstream, synced_at = excluded.synced_at`);
  for (const a of list) up.run(a.id, a.display_name ?? a.username ?? a.id, a.platform, a.username ?? null, null, a.status === 'connected' ? 0 : 1, 50);
  db.prepare(`DELETE FROM channels WHERE id NOT IN (${list.map(() => '?').join(',') || "''"}) AND id NOT IN (SELECT channel_id FROM publications)`).run(...list.map((a) => a.id));
  return list.length;
}

/** Which account each format may go to. Stored as exclusions, so a newly connected account is on for every format. */
export const routing = (): Record<string, string[]> => JSON.parse(getSetting('routing', '{}')) as Record<string, string[]>;

export function setRoute(template: string, channelId: string, allowed: boolean): void {
  const all = routing();
  const blocked = new Set(all[template] ?? []);
  if (allowed) blocked.delete(channelId); else blocked.add(channelId);
  setSetting('routing', JSON.stringify({ ...all, [template]: [...blocked] }));
}

/** Enabled accounts that a clip of this format may go to. */
export function routesFor(template: string | null, channelIds: string[]): string[] {
  const blocked = new Set(routing()[template ?? ''] ?? []);
  return channelIds.filter((id) => !blocked.has(id));
}

export const enabledChannelIds = () => (db.prepare('SELECT id FROM channels WHERE enabled = 1 AND disabled_upstream = 0').all() as { id: string }[]).map((c) => c.id);

/** Books approved clips on today's and tomorrow's slots, highest priority first. Later days stay free, so new priorities can always go out soon. */
export function planAndBook(now = new Date()): number {
  const channels = (db.prepare('SELECT id, provider, max_per_day, vol_start, vol_step, vol_every, vol_since FROM channels WHERE enabled = 1 AND disabled_upstream = 0').all() as ({ id: string; provider: string } & ChannelVolumeRow)[])
    .map((c): PlanChannel => { const own = channelVolume(c); return { id: c.id, provider: c.provider, maxPerDay: c.max_per_day, ...(own ? { volumeOn: (d: Date) => volumeOn(own, d) } : {}) }; });
  if (!channels.length) return 0;
  const rows = db.prepare("SELECT c.id, c.template, c.viral note, c.approved_by = 'manual' manual, s.path IS NOT NULL uploaded, c.hook, c.transcript, c.shelf_life, s.published_at FROM clips c JOIN sources s ON s.id = c.source_id WHERE c.status IN ('approved', 'scheduled')").all() as { id: string; template: string | null; note: number | null; manual: number | null; uploaded: number; hook: string | null; transcript: string | null; shelf_life: string | null; published_at: string | null }[];
  const ids = channels.map((c) => c.id);
  const clips = rows.map((c) => ({ id: c.id, channels: routesFor(c.template, ids), score: priority({ id: c.id, note: c.note ?? 0, manual: Boolean(c.manual), uploaded: Boolean(c.uploaded), stale: freshness(`${c.hook ?? ''} ${c.transcript ?? ''}`, c.shelf_life, c.published_at, now).stale }) }));
  const booked = (db.prepare("SELECT clip_id, channel_id, scheduled_at FROM publications WHERE state NOT IN ('cancelled','error')").all() as { clip_id: string; channel_id: string; scheduled_at: string }[])
    .map((b) => ({ clipId: b.clip_id, channelId: b.channel_id, at: new Date(b.scheduled_at) }));
  const volume = volumeSettingsFromDb(now);
  const plan = planPublications(clips, channels, booked, {
    now,
    startHour: Number(getSetting('post_start_hour', '9')),
    endHour: Number(getSetting('post_end_hour', '21')),
    minGapHours: Number(getSetting('post_min_gap_hours', '1')),
    horizonDays: 2,
    volumeOn: (d) => volumeOn(volume, d),
  });
  const insert = db.prepare("INSERT OR IGNORE INTO publications (id, clip_id, channel_id, scheduled_at) VALUES (?,?,?,?)");
  for (const p of plan) {
    const id = `pub-${crypto.randomBytes(5).toString('hex')}`;
    // A cancelled or failed attempt must not block planning the clip on this channel again.
    db.prepare("DELETE FROM publications WHERE clip_id = ? AND channel_id = ? AND state IN ('cancelled','error')").run(p.clipId, p.channelId);
    insert.run(id, p.clipId, p.channelId, p.at.toISOString());
    db.prepare("UPDATE clips SET status = 'scheduled' WHERE id = ?").run(p.clipId);
    enqueue('publish', id);
  }
  return plan.length;
}

function volumeSettingsFromDb(now: Date): VolumeSettings {
  let startDate = getSetting('volume_start_date', '');
  if (!startDate) { startDate = now.toLocaleDateString('sv-SE'); setSetting('volume_start_date', startDate); }
  return { start: Number(getSetting('volume_start', '6')), step: Number(getSetting('volume_step', '1')), everyDays: Number(getSetting('volume_every_days', '3')), max: Number(getSetting('volume_max', '40')), startDate };
}

/** The post's description: by default the same text on every post, set in the app. */
export function postText(row: { caption: string | null; hook: string; provider?: string; source_url?: string | null; source_kind?: string | null }): string {
  const text = getSetting('caption_unique', '1') === '1' ? getSetting('caption_text', DEFAULT_CAPTION) : row.caption ?? row.hook.replace(/\*/g, '');
  if (row.provider !== 'youtube') return text;
  // On YouTube, the Short points to the full video it comes from, or to his latest video when it comes from elsewhere.
  const fromYouTube = row.source_url && /youtu\.?be/.test(row.source_url) ? row.source_url : null;
  const latest = (db.prepare("SELECT url FROM sources WHERE url LIKE '%youtu%' AND kind = 'youtube' AND published_at IS NOT NULL ORDER BY published_at DESC LIMIT 1").get() as { url: string } | undefined)?.url;
  const link = fromYouTube ?? latest;
  return link ? `${text}\n\nLa vidéo complète : ${link}` : text;
}

/** Uploads the video, then creates the scheduled post in TryPost. TryPost does the actual posting at the set time. */
export async function publish(pubId: string): Promise<void> {
  const row = db.prepare(`SELECT p.scheduled_at, p.state, c.output, c.hook, c.caption, ch.id channel_id, ch.provider, s.url source_url, s.kind source_kind
    FROM publications p JOIN clips c ON c.id = p.clip_id JOIN channels ch ON ch.id = p.channel_id JOIN sources s ON s.id = c.source_id WHERE p.id = ?`).get(pubId) as { scheduled_at: string; state: string; output: string; hook: string; caption: string | null; channel_id: string; provider: string; source_url: string | null; source_kind: string | null } | undefined;
  if (!row || row.state === 'cancelled') return;
  const client = tryPostClient();
  if (!client) throw new Retry('Clé TryPost manquante : en attente', 3600);
  const when = new Date(row.scheduled_at) < new Date(Date.now() + 5 * 60_000) ? new Date(Date.now() + 10 * 60_000).toISOString() : row.scheduled_at;
  const draft = getSetting('post_as_draft', '0') === '1';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shorts-pub-'));
  try {
    const light = path.join(dir, `${pubId}.mp4`);
    await run('ffmpeg', ['-v', 'error', '-y', '-i', row.output, '-c:v', 'h264_videotoolbox', '-b:v', '7M', '-maxrate', '9M', '-bufsize', '14M', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', light]);
    const uploadToken = await client.upload(light);
    const remoteId = await client.createPost({
      status: draft ? 'draft' : 'scheduled', ...(draft ? {} : { scheduledAt: when }),
      socialAccountId: row.channel_id, platform: row.provider, title: row.hook, content: postText(row), uploadToken,
    });
    db.prepare('UPDATE publications SET state = ?, remote_id = ?, scheduled_at = ?, error = NULL WHERE id = ?').run(draft ? 'draft' : 'queued', remoteId, when, pubId);
  } catch (error) {
    db.prepare('UPDATE publications SET error = ? WHERE id = ?').run(error instanceof Error ? error.message.slice(0, 500) : 'Erreur', pubId);
    throw error;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export async function cancelPublication(pubId: string): Promise<void> {
  const p = db.prepare('SELECT remote_id, clip_id, state FROM publications WHERE id = ?').get(pubId) as { remote_id: string | null; clip_id: string; state: string } | undefined;
  if (!p) throw new Error('Publication inconnue');
  if (p.state === 'published') throw new Error('Déjà publié : à retirer directement sur le réseau');
  if (p.remote_id) await requireClient().deletePost(p.remote_id);
  db.prepare("UPDATE publications SET state = 'cancelled' WHERE id = ?").run(pubId);
  const left = (db.prepare("SELECT COUNT(*) n FROM publications WHERE clip_id = ? AND state NOT IN ('cancelled','error')").get(p.clip_id) as { n: number }).n;
  if (!left) db.prepare("UPDATE clips SET status = 'approved' WHERE id = ? AND status = 'scheduled'").run(p.clip_id);
}

/** Pulls post states, publication links and per-post stats. The stats feed the hook scorer and the note. */
export async function sync(): Promise<void> {
  const client = tryPostClient();
  if (!client) return;
  const ctx = { name: 'trypost.sync' };
  const pending = db.prepare("SELECT id, remote_id FROM publications WHERE state IN ('queued','draft') AND remote_id IS NOT NULL ORDER BY scheduled_at LIMIT ?").all(CHECKS_PER_RUN) as { id: string; remote_id: string }[];
  const update = db.prepare('UPDATE publications SET state = ?, release_url = COALESCE(?, release_url), error = ? WHERE id = ?');
  for (const p of pending) {
    try {
      const post = await client.getPost(p.remote_id);
      update.run(publicationState(post), post.platform_url ?? null, post.error_message ?? null, p.id);
    } catch (error) {
      log.warn({ ...ctx, pub: p.id, error: error instanceof Error ? error.message : String(error) }, 'État indisponible');
    }
  }
  const due = db.prepare(`SELECT p.id, p.remote_id, p.clip_id, p.channel_id, ch.name account, ch.provider FROM publications p JOIN channels ch ON ch.id = p.channel_id
    WHERE p.state = 'published' AND p.remote_id IS NOT NULL AND (p.measured_at IS NULL OR p.measured_at < datetime('now', '-6 hours'))
    ORDER BY p.measured_at IS NOT NULL, p.measured_at LIMIT ?`).all(CHECKS_PER_RUN) as { id: string; remote_id: string; clip_id: string; channel_id: string; account: string; provider: string }[];
  const metric = db.prepare(`INSERT OR REPLACE INTO metrics (clip_id, channel_id, account, platform, measured_at, views, impressions, reach, likes, comments, sends, saves, avg_watch_s) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const d of due) {
    try {
      const r = await client.postMetrics(d.remote_id);
      if (['views', 'impressions', 'reach', 'likes', 'comments', 'sends', 'saves', 'avg_watch_s'].some(k => r[k as keyof typeof r] != null)) {
        metric.run(d.clip_id, d.channel_id, d.account, d.provider, r.observed_at ?? new Date().toISOString(), r.views ?? null, r.impressions ?? null, r.reach ?? null, r.likes ?? null, r.comments ?? null, r.sends ?? null, r.saves ?? null, r.avg_watch_s ?? null);
      }
      if (r.published_at) db.prepare('UPDATE publications SET published_at = ? WHERE id = ?').run(r.published_at, d.id);
      db.prepare("UPDATE publications SET measured_at = datetime('now') WHERE id = ?").run(d.id);
    } catch (error) {
      log.warn({ ...ctx, pub: d.id, error: error instanceof Error ? error.message : String(error) }, 'Stats indisponibles');
    }
  }
}

export function statsSummary() {
  const byType = (col: string) => db.prepare(`SELECT c.${col} name, COUNT(DISTINCT c.id) clips, ROUND(AVG(m.views)) views, ROUND(AVG(m.likes)) likes, ROUND(AVG(m.sends), 1) sends FROM latest_metrics m JOIN clips c ON c.id = m.clip_id GROUP BY c.${col} ORDER BY views DESC`).all();
  return {
    byHook: byType('hook_type'),
    byTemplate: byType('template'),
    byAccount: db.prepare('SELECT account name, platform, COUNT(DISTINCT clip_id) clips, ROUND(AVG(views)) views, SUM(views) total FROM latest_metrics GROUP BY account, platform ORDER BY total DESC').all(),
    top: db.prepare('SELECT c.id, c.hook, c.hook_type, c.template, MAX(m.views) views, MAX(m.sends) sends FROM latest_metrics m JOIN clips c ON c.id = m.clip_id GROUP BY c.id ORDER BY views DESC LIMIT 20').all(),
    published: (db.prepare("SELECT COUNT(*) n FROM publications WHERE state = 'published'").get() as { n: number }).n,
    planned: (db.prepare("SELECT COUNT(*) n FROM publications WHERE state IN ('planned','queued','draft')").get() as { n: number }).n,
  };
}
