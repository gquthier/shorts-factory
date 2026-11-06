import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { contentFor, createTryPostClient, metricsToRow, publicationState, TryPostError } from '../src/lib/trypost.ts';

function mock(handler: (req: http.IncomingMessage, body: Buffer, res: http.ServerResponse) => void) {
  return new Promise<{ url: string; close: () => void }>((resolve) => {
    const s = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (d: Buffer) => chunks.push(d));
      req.on('end', () => handler(req, Buffer.concat(chunks), res));
    });
    s.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, close: () => s.close() }));
  });
}
const send = (res: http.ServerResponse, status: number, body: unknown, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(body === null ? '' : JSON.stringify(body)); };

test('sends a Bearer key with Accept and reads accounts from data', async () => {
  let auth; let accept;
  const m = await mock((req, _b, res) => { auth = req.headers.authorization; accept = req.headers.accept; send(res, 200, { data: [{ id: 'a1', platform: 'tiktok', display_name: 'G', username: 'g', status: 'connected' }], meta: {} }); });
  const list = await createTryPostClient({ baseUrl: m.url, apiKey: 'secret' }).listAccounts();
  m.close();
  assert.equal(auth, 'Bearer secret');
  assert.equal(accept, 'application/json');
  assert.equal(list[0]!.platform, 'tiktok');
});

test('uploads a video as multipart, field media, and returns the token', async () => {
  let body = ''; let url = '';
  const m = await mock((req, b, res) => { url = req.url ?? ''; body = b.toString('latin1'); send(res, 201, { upload_token: 'tok', type: 'video', mime_type: 'video/mp4', size: 5, original_filename: 'a.mp4', url: 'u', expires_at: 'x' }); });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-'));
  const file = path.join(dir, 'a.mp4');
  fs.writeFileSync(file, 'video');
  const token = await createTryPostClient({ baseUrl: m.url, apiKey: 'k' }).upload(file);
  m.close();
  fs.rmSync(dir, { recursive: true });
  assert.equal(url, '/uploads');
  assert.match(body, /name="media"; filename="a\.mp4"/);
  assert.equal(token, 'tok');
});

test('creates a scheduled reel with the documented body', async () => {
  let sent: Record<string, unknown> = {};
  const m = await mock((_r, b, res) => { sent = JSON.parse(b.toString()) as Record<string, unknown>; send(res, 201, { id: 'p9', status: 'scheduled' }); });
  const id = await createTryPostClient({ baseUrl: m.url, apiKey: 'k' }).createPost({ status: 'scheduled', scheduledAt: '2026-11-06T09:00:00.000Z', socialAccountId: 'a1', platform: 'instagram', title: 't', content: 'Légende', uploadToken: 'tok' });
  m.close();
  assert.equal(id, 'p9');
  assert.equal(sent.status, 'scheduled');
  assert.equal(sent.scheduled_at, '2026-11-06T09:00:00.000Z');
  assert.equal(sent.social_account_id, 'a1');
  assert.equal(sent.content_type, 'instagram_reel');
  assert.deepEqual(sent.media, [{ upload_token: 'tok' }]);
});

test('a draft carries no scheduled time', async () => {
  let sent: Record<string, unknown> = {};
  const m = await mock((_r, b, res) => { sent = JSON.parse(b.toString()) as Record<string, unknown>; send(res, 201, { id: 'd1' }); });
  await createTryPostClient({ baseUrl: m.url, apiKey: 'k' }).createPost({ status: 'draft', socialAccountId: 'a1', platform: 'tiktok', title: 't', content: 'c', uploadToken: 'tok' });
  m.close();
  assert.equal(sent.status, 'draft');
  assert.equal(sent.scheduled_at, undefined);
});

test('a bad key or a refused body fails at once', async () => {
  for (const status of [401, 402, 422]) {
    let calls = 0;
    const m = await mock((_r, _b, res) => { calls += 1; send(res, status, { message: 'nope' }); });
    await assert.rejects(createTryPostClient({ baseUrl: m.url, apiKey: 'k', retryDelayMs: 1 }).listAccounts(), (e: TryPostError) => e.status === status);
    m.close();
    assert.equal(calls, 1);
  }
});

test('rate limits, busy queues and server errors are retried', async () => {
  let calls = 0;
  const m = await mock((_r, _b, res) => { calls += 1; if (calls === 1) send(res, 429, {}, { 'retry-after': '0' }); else if (calls === 2) send(res, 409, {}); else if (calls === 3) send(res, 503, {}); else send(res, 200, { data: [] }); });
  assert.deepEqual(await createTryPostClient({ baseUrl: m.url, apiKey: 'k', retryDelayMs: 1 }).listAccounts(), []);
  m.close();
  assert.equal(calls, 4);
});

test('a delete answering 204 with no body is fine', async () => {
  const m = await mock((req, _b, res) => { assert.equal(req.method, 'DELETE'); send(res, 204, null); });
  await createTryPostClient({ baseUrl: m.url, apiKey: 'k' }).deletePost('p1');
  m.close();
});

test('each network gets its format and required settings', () => {
  assert.equal(contentFor('instagram', 't').content_type, 'instagram_reel');
  assert.equal(contentFor('instagram-facebook', 't').content_type, 'instagram_reel');
  assert.deepEqual(contentFor('tiktok', 't'), { content_type: 'tiktok_video', meta: { privacy_level: 'PUBLIC_TO_EVERYONE' } });
  assert.equal(contentFor('youtube', 'x'.repeat(200)).meta.title, 'x'.repeat(100));
  assert.equal(contentFor('youtube', 'Mon <*hook*>').meta.title, 'Mon hook');
  assert.throws(() => contentFor('linkedin', 't'));
});

test('publication states combine both status fields', () => {
  assert.equal(publicationState({ status: 'draft', publish_status: 'pending' }), 'draft');
  assert.equal(publicationState({ status: 'scheduled', publish_status: 'pending' }), 'queued');
  assert.equal(publicationState({ status: 'publishing', publish_status: 'retrying' }), 'queued');
  assert.equal(publicationState({ status: 'published', publish_status: 'published' }), 'published');
  assert.equal(publicationState({ status: 'failed', publish_status: 'failed' }), 'error');
  assert.equal(publicationState({ status: 'publishing', publish_status: 'rejected' }), 'error');
});

test('metrics map from the latest snapshot', () => {
  const row = metricsToRow({ metrics: [{ available: true, snapshot: { views_count: 1200, reactions_count: 50, comments_count: 3, shares_count: 9, saves_count: 4, average_watch_time_milliseconds: 12500 } }] });
  assert.deepEqual(row, { views: 1200, likes: 50, comments: 3, sends: 9, saves: 4, avg_watch_s: 12.5 });
  assert.deepEqual(metricsToRow({ metrics: [{ available: true, snapshot: { impressions_count: 80 } }] }), { impressions: 80 });
  assert.deepEqual(metricsToRow({ metrics: [] }), {});
  assert.deepEqual(metricsToRow({ metrics: [{ available: false, snapshot: null }] }), {});
});


test('current TryPost object envelope separates exposure metrics and retains publication date', () => {
  assert.deepEqual(metricsToRow({ metrics: { available: true, publication: { provider_published_at: '2026-11-05T20:36:06+00:00' }, snapshot: { collected_at: '2026-11-06T04:58:56+00:00', views_count: 213, impressions_count: null, reach_count: 160, reactions_count: 3, comments_count: 0, shares_count: 0, saves_count: 0, average_watch_time_milliseconds: 6554 } } }),
    { published_at: '2026-11-05T20:36:06+00:00', observed_at: '2026-11-06T04:58:56+00:00', views: 213, reach: 160, likes: 3, comments: 0, sends: 0, saves: 0, avg_watch_s: 6.554 });
  assert.deepEqual(metricsToRow({ metrics: { available: false, snapshot: { views_count: 5 } } }), {});
  assert.deepEqual(metricsToRow({ metrics: [{ snapshot: { collected_at: '2026-11-01', views_count: 5 } }, { snapshot: { collected_at: '2026-11-05', views_count: 12 } }] }), { views: 12, observed_at: '2026-11-05' });
});
