import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPerformance, performanceBrief, hookPerformanceEvidence, classifyTopic, type PerformanceRow } from '../src/lib/performance.ts';

const now = new Date('2026-11-06T12:00:00Z');
const row = (id: string, extra = {}): PerformanceRow => ({
  id, clip_id: id, channel_id: 'ig1', account: 'Alex', platform: 'instagram',
  title: 'Agents IA', hook: 'Mon équipe IA', hook_type: 'preuve', template: 'black-frame', format: 'methode',
  topic: 'IA & automatisation', topic_manual: false, published_at: '2026-10-28T12:00:00Z',
  measured_at: '2026-11-06T10:00:00Z', release_url: null,
  views: 100, impressions: null, reach: 80, likes: 8, comments: 1, sends: 1, saves: 0, avg_watch_s: 12,
  ...extra,
});

test('filters use channel identity, publication date and selected metric threshold', () => {
  const rows = [row('a'), row('b', { channel_id: 'yt1', platform: 'youtube', views: 200 }), row('old', { published_at: '2025-01-01' }), row('unknown', { published_at: null }), row('zero', { views: 0 })];
  const s = buildPerformance(rows, { channel: 'ig1', days: 30, metric: 'views', minimum: 50 }, now);
  assert.deepEqual(s.top.map(r => r.id), ['a']);
  assert.equal(s.totals.views.value, 100);
  assert.equal(buildPerformance(rows, { platform: 'youtube' }, now).count, 1);
  assert.equal(buildPerformance(rows, { days: 0 }, now).count, 5);
});

test('missing metrics stay missing; zero is measured; interactions require all three components', () => {
  const s = buildPerformance([row('a'), row('b', { views: 0, likes: 0, comments: 0, sends: 0 }), row('c', { views: null, comments: null })], {}, now);
  assert.deepEqual(s.totals.views, { value: 100, covered: 2 });
  assert.deepEqual(s.totals.impressions, { value: null, covered: 0 });
  assert.deepEqual(s.totals.interactions, { value: 10, covered: 2 });
  assert.deepEqual(s.totals.engagement, { value: 10, covered: 1 });
  assert.equal(s.byTopic[0].median, 50);
});

test('rankings follow selected metric and use the median instead of a viral outlier', () => {
  const rows = [row('a', { views: 100000, sends: 0 }), row('b', { views: 100, sends: 0 }), row('c', { views: 100, sends: 0 }), ...[1, 2, 3].map(i => row(`sales${i}`, { views: 1000, sends: 20, topic: 'Vente & offres', format: 'histoire' }))];
  const s = buildPerformance(rows, { metric: 'views' }, now);
  assert.equal(s.byTopic[0].name, 'Vente & offres');
  assert.equal(s.byTopic[1].median, 100);
  assert.ok(s.insights.some(i => i.name === 'Vente & offres'));
  assert.equal(buildPerformance(rows, { metric: 'sends' }, now).top[0].sends, 20);
});

test('learning requires three distinct mature clips per group, with a positive baseline and same channel', () => {
  assert.equal(buildPerformance([row('a')], {}, now).insights.length, 0);
  assert.equal(buildPerformance([row('a'), row('b'), row('c')], {}, now).insights.length, 0, 'one group is not a comparison');
  const same = [row('a'), row('a2', { clip_id: 'a' }), row('a3', { clip_id: 'a' }), row('b', { views: 1, topic: 'Vente & offres' })];
  assert.equal(buildPerformance(same, {}, now).insights.length, 0);
  const fresh = [row('a', { published_at: now.toISOString() }), row('b', { published_at: now.toISOString() }), row('c', { published_at: now.toISOString() }), row('d', { topic: 'Vente & offres', views: 1 })];
  assert.equal(buildPerformance(fresh, {}, now).insights.length, 0);
  const mixed = [row('a'), row('b'), row('c'), row('d', { channel_id: 'yt', platform: 'youtube', topic: 'Vente & offres', views: 1 })];
  assert.equal(buildPerformance(mixed, {}, now).insights.length, 0);
});

test('brief contains the filters and actual evidence, and never invents a winner', () => {
  const brief = performanceBrief(buildPerformance([row('a')], { channel: 'ig1', metric: 'impressions' }, now));
  assert.match(brief, /impressions/);
  assert.match(brief, /ig1/);
  assert.match(brief, /insuffisant/i);
  assert.doesNotMatch(brief, /100000/);
  assert.equal(classifyTopic('Mes agents IA travaillent pour moi'), 'IA & automatisation');
  assert.equal(classifyTopic('Une balade dans la forêt'), 'Non classé');
});

test('hook feedback separates channels and needs five mature clips on each side', () => {
  const strong = Array.from({ length: 5 }, (_, i) => row(`strong${i}`, { views: i === 0 ? 100000 : 500 }));
  const peers = Array.from({ length: 5 }, (_, i) => row(`peer${i}`, { hook_type: 'methode', views: 100 }));
  assert.deepEqual(hookPerformanceEvidence(strong, now), []);
  assert.deepEqual(hookPerformanceEvidence([...strong, ...peers.map(r => ({ ...r, channel_id: 'yt', platform: 'youtube' }))], now), []);
  assert.deepEqual(hookPerformanceEvidence([...strong, ...peers.map(r => ({ ...r, published_at: now.toISOString() }))], now), []);
  assert.deepEqual(hookPerformanceEvidence([...strong, ...peers.map(r => ({ ...r, published_at: null }))], now), []);
  assert.deepEqual(hookPerformanceEvidence([...strong, ...peers.map(r => ({ ...r, clip_id: 'duplicate' }))], now), []);
  const evidence = hookPerformanceEvidence([...strong, ...peers, row('missing', { views: null }), row('untyped', { hook_type: null })], now);
  assert.equal(evidence.length, 2);
  const winner = evidence.find(r => r.type === 'preuve')!;
  assert.equal(winner.median_views, 500);
  assert.equal(winner.baseline_views, 100);
  assert.equal(winner.ratio, 5);
  assert.equal(winner.channel_id, 'ig1');
});
