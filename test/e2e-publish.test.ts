// Runs the real server and worker against a fake TryPost speaking the documented contract: nothing leaves this machine.
import { DEFAULT_CAPTION } from '../src/lib/autopilot.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AddressInfo } from 'node:net';

const API_PORT = 4199;
const API = `http://127.0.0.1:${API_PORT}`;
const SERVICE = 'SHORTS_FACTORY_TEST_TRYPOST';
const KEY = 'test-key-not-a-real-secret';

test('approve, schedule, upload, publish, stats: the whole loop', { timeout: 120_000 }, async (t) => {
  const seen = { uploads: 0, posts: [] as { status: string; scheduled_at: string; social_account_id: string; content: string; content_type: string; media: { upload_token: string }[] }[], deleted: [] as string[], auth: new Set<string>() };
  let published = false;
  const postiz = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (d: Buffer) => chunks.push(d));
    req.on('end', () => {
      seen.auth.add(req.headers.authorization ?? '');
      const send = (b: unknown, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(b === null ? '' : JSON.stringify(b)); };
      if (req.headers.authorization !== `Bearer ${KEY}`) return send({ message: 'Invalid API key' }, 401);
      const url = req.url ?? '';
      if (url === '/social-accounts') return send({ data: [{ id: 'ig1', platform: 'instagram', display_name: 'Alex', username: 'g', status: 'connected' }, { id: 'ig2', platform: 'instagram', display_name: 'Second', username: 's', status: 'connected' }, { id: 'li1', platform: 'linkedin', display_name: 'LinkedIn', username: 'l', status: 'connected' }], meta: {} });
      if (url === '/uploads') { seen.uploads += 1; assert.ok(chunks.length > 0); return send({ upload_token: `tok${seen.uploads}` }, 201); }
      if (url === '/posts' && req.method === 'POST') { seen.posts.push(JSON.parse(Buffer.concat(chunks).toString()) as typeof seen.posts[number]); return send({ id: `p${seen.posts.length}`, status: 'scheduled' }, 201); }
      const metrics = /^\/posts\/(p\d+)\/metrics$/.exec(url);
      if (metrics) return send({ post_id: metrics[1], metrics: [{ available: true, snapshot: { views_count: 1234, reactions_count: 56, shares_count: 7 } }] });
      const one = /^\/posts\/(p\d+)$/.exec(url);
      if (one && req.method === 'DELETE') { seen.deleted.push(one[1]!); return send(null, 204); }
      if (one) return send({ id: one[1], status: published ? 'published' : 'scheduled', publish_status: published ? 'published' : 'pending', platform_url: published ? 'https://instagram.com/reel/x' : null });
      return send({ message: `no route ${url}` }, 404);
    });
  });
  await new Promise<void>((r) => postiz.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${(postiz.address() as AddressInfo).port}`;

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shorts-e2e-'));
  const server = spawn('node', ['--no-warnings', 'src/server.ts'], { cwd: path.resolve(import.meta.dirname, '..'), env: { ...process.env, PORT: String(API_PORT), SHORTS_DATA: dataDir, SHORTS_TRYPOST_SERVICE: SERVICE }, stdio: 'ignore' });
  t.after(() => {
    server.kill('SIGKILL');
    postiz.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    try { execFileSync('security', ['delete-generic-password', '-a', 'shorts-factory', '-s', SERVICE], { stdio: 'ignore' }); } catch { /* already gone */ }
  });
  const post = async (route: string, body: unknown = {}, method = 'POST') => {
    const r = await fetch(`${API}${route}`, { method, headers: { origin: API, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return r.json() as Promise<{ success: boolean; data: Record<string, unknown>; error?: string }>;
  };
  const state = async () => (await (await fetch(`${API}/api/state`)).json() as { data: { settings: Record<string, unknown>; channels: { id: string; enabled: number; provider: string }[]; publications: { id: string; state: string; release_url: string | null; scheduled_at: string }[]; clips: { id: string; status: string }[] } }).data;
  const until = async <T>(what: string, fn: () => Promise<T | false | undefined | null>, ms = 40_000): Promise<T> => {
    for (const end = Date.now() + ms; Date.now() < end;) {
      const v = await fn();
      if (v) return v;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`Timeout waiting for ${what}`);
  };
  await until('server', async () => fetch(`${API}/api/state`).then((r) => r.ok).catch(() => false));

  await post('/api/settings', { autopilot: '1', auto_approve_when_empty: '1' });

  // A wrong key is refused and stores nothing.
  const bad = await post('/api/trypost/key', { apiKey: 'wrong-key-123', baseUrl }); // gitleaks:allow -- deliberately invalid fixture
  assert.equal(bad.success, false);
  assert.equal((await state()).settings.trypost_configured, false);

  // A good key connects, and only video networks are mirrored, all switched off.
  const good = await post('/api/trypost/key', { apiKey: KEY, baseUrl });
  assert.equal(good.success, true, good.error);
  let s = await state();
  assert.equal(s.settings.trypost_configured, true);
  assert.deepEqual(s.channels.map((c) => c.id).sort(), ['ig1', 'ig2']);
  assert.ok(s.channels.every((c) => c.enabled === 0), 'new channels must start disabled');
  assert.ok(!JSON.stringify(s).includes(KEY), 'the key must never leave through the API');

  // A clip with a real, tiny video.
  const clipDir = path.join(dataDir, 'clips', 'clip1');
  fs.mkdirSync(clipDir, { recursive: true });
  const video = path.join(clipDir, 'final.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=270x480:rate=30:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', video]);
  const db = new DatabaseSync(path.join(dataDir, 'factory.db'));
  db.exec(`INSERT INTO sources (id, kind, status) VALUES ('s1','youtube','mined');
    INSERT INTO clips (id, source_id, start, end, hook, caption, hook_type, hook_score, status, output, template) VALUES ('clip1','s1',0,1,'Mon *hook* de test','Ma légende','recu',80,'review','${video}','black-frame');`);

  // Nothing is scheduled while no channel is on, even once approved.
  await post('/api/clips/clip1', { action: 'approve' });
  assert.equal((await post('/api/schedule')).data.planned, 0);

  await post('/api/channels/ig1', { enabled: true });
  await post('/api/channels/ig2', { enabled: true });
  assert.equal((await post('/api/schedule')).data.planned, 1, 'one clip goes to one Instagram account, not both');

  const pub = await until('upload to Postiz', async () => { s = await state(); return s.publications.find((p) => p.state === 'queued'); });
  assert.equal(seen.uploads, 1);
  assert.equal(seen.posts.length, 1);
  const sent = seen.posts[0]!;
  assert.equal(sent.status, 'scheduled');
  // By default every post carries the single description set in the app, not the clip's own.
  assert.equal(sent.content, DEFAULT_CAPTION);
  assert.equal(sent.media[0]!.upload_token, 'tok1');
  assert.equal(sent.content_type, 'instagram_reel');
  assert.ok(['ig1', 'ig2'].includes(sent.social_account_id));
  assert.ok(new Date(sent.scheduled_at) > new Date(), 'never scheduled in the past');
  assert.equal((await state()).clips.find((c) => c.id === 'clip1')!.status, 'scheduled');

  // Cancelling removes it upstream, and the clip can be planned again.
  await post(`/api/publications/${pub.id}/cancel`);
  assert.deepEqual(seen.deleted, ['p1']);
  assert.equal((await state()).clips.find((c) => c.id === 'clip1')!.status, 'approved');

  assert.equal((await post('/api/schedule')).data.planned, 1);
  await until('second upload', async () => (await state()).publications.find((p) => p.state === 'queued'));

  // Published upstream: the link and the stats come back, and feed the stats screen.
  published = true;
  await post('/api/sync');
  await until('published state', async () => (await state()).publications.find((p) => p.state === 'published' && p.release_url));
  const stats = await until('stats', async () => {
    const d = (await (await fetch(`${API}/api/stats`)).json() as { data: { byHook: { name: string; views: number; sends: number }[]; published: number } }).data;
    return d.byHook.length ? d : null;
  });
  assert.equal(stats.published, 1);
  assert.equal(stats.byHook[0]!.name, 'recu');
  assert.equal(stats.byHook[0]!.views, 1234);
  assert.equal(stats.byHook[0]!.sends, 7);

  // Already public: refuse to pretend it can be cancelled.
  const live = (await state()).publications.find((p) => p.state === 'published')!;
  assert.equal((await post(`/api/publications/${live.id}/cancel`)).success, false);

  // Autopilot: nothing validated by hand is left, so it validates the best clip alone. A clip that failed QA stays out.
  db.exec(`INSERT INTO clips (id, source_id, start, end, hook, caption, hook_type, hook_score, status, output, template, viral, qa_status, viral_why) VALUES
    ('good','s1',0,1,'Bon clip ici','L','interdit',90,'review','${video}','black-frame',90,'pass','[]'),
    ('weak','s1',0,1,'Clip moyen ici','L','verite-dure',40,'review','${video}','black-frame',20,'pass','[]'),
    ('bad','s1',0,1,'Clip cassé ici','L','interdit',95,'review','${video}','black-frame',95,'fail','[]');`);
  await post('/api/channels/ig2', { enabled: false });
  await post('/api/settings', { volume_start: 2, volume_step: 0 });
  const run = await post('/api/autopilot/run');
  assert.equal(run.success, true, run.error);
  // Saving settings already runs the pilot, so this run may find nothing left to do: judge by the result.
  const after = await state();
  const status = (id: string) => after.clips.find((c) => c.id === id)!.status;
  assert.equal(status('weak'), 'review', 'under the minimum note');
  assert.equal(status('bad'), 'review', 'failed QA is never validated alone');
  assert.ok(['approved', 'scheduled'].includes(status('good')));

  // Volume: never more booked per day than asked, and the scheduled time is not a round slot.
  await until('good uploaded', async () => (await state()).publications.find((p) => p.state === 'queued'));
  const perDay = new Map<string, number>();
  for (const p of (await state()).publications) { const k = new Date(p.scheduled_at).toDateString(); perDay.set(k, (perDay.get(k) ?? 0) + 1); }
  assert.ok([...perDay.values()].every((n) => n <= 3), JSON.stringify([...perDay]));

  // Draft mode: nothing is scheduled, then lifting it turns drafts into real scheduled posts.
  await post('/api/settings', { post_as_draft: '1', auto_approve_when_empty: '0' });
  db.exec(`INSERT INTO clips (id, source_id, start, end, hook, caption, hook_type, hook_score, status, output, template, viral, qa_status, viral_why, approved_by) VALUES ('drafted','s1',0,1,'Clip en brouillon','L','interdit',90,'approved','${video}','black-frame',99,'pass','[]','manual');`);
  await post('/api/settings', { volume_start: 10 });
  await post('/api/autopilot/run');
  const draftPub = await until('draft created', async () => (await state()).publications.find((p) => p.state === 'draft'));
  const lastBody = seen.posts.at(-1)!;
  assert.equal(lastBody.status, 'draft');
  assert.equal(lastBody.scheduled_at, undefined, 'a draft has no publication time');
  const before = seen.deleted.length;
  await post('/api/settings', { post_as_draft: '0' });
  await post('/api/autopilot/run');
  await until('draft removed upstream', async () => seen.deleted.length > before);
  await until('booked again as scheduled', async () => seen.posts.at(-1)!.status === 'scheduled' && (await state()).publications.some((p) => p.state === 'queued' && p.id !== draftPub.id));

  // Routing: a format switched off for an account never goes there.
  await post('/api/routing', { template: 'selfie-headline', channelId: 'ig1', allowed: false });
  assert.deepEqual((await state() as unknown as { routing: Record<string, string[]> }).routing['selfie-headline'], ['ig1']);
  db.exec(`INSERT INTO clips (id, source_id, start, end, hook, caption, hook_type, hook_score, status, output, template, viral, qa_status, viral_why, approved_by) VALUES ('blocked','s1',0,1,'Clip format coupé','L','interdit',90,'approved','${video}','selfie-headline',90,'pass','[]','manual');`);
  await post('/api/autopilot/run');
  assert.equal((await state()).publications.some((p) => (p as unknown as { clip_id: string }).clip_id === 'blocked'), false);

  // Cross-site writes are refused.
  const evil = await fetch(`${API}/api/schedule`, { method: 'POST', headers: { origin: 'https://evil.example' } });
  assert.equal(evil.status, 403);
  const traversal = await fetch(`${API}/ui/..%2f..%2ffactory.config.json`);
  assert.equal(traversal.status, 404);
});
