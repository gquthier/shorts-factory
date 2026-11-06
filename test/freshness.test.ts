import test from 'node:test';
import assert from 'node:assert/strict';
import { ageInDays, freshness, parseUploadDate, shelfLife } from '../src/lib/freshness.ts';
import { byPriority, pickAutoApprovals, pickEvictions, tier } from '../src/lib/autopilot.ts';

const now = new Date(2026, 10, 5, 12);

test('launch topics are news, tools are trends, principles last', () => {
  assert.equal(shelfLife("OpenClaw est déjà mort, voici pourquoi"), 'news');
  assert.equal(shelfLife("L'agent IA Hermes en autonomie"), 'news');
  assert.equal(shelfLife('Anthropic vient de sortir un truc'), 'news');
  assert.equal(shelfLife('GPT-6 change tout'), 'news');
  assert.equal(shelfLife('Claude Code et les agents au quotidien'), 'trend');
  assert.equal(shelfLife('Ton offre ne se vend pas parce que tu ne fais pas assez de calls'), 'evergreen');
});

test('the writer can only make a clip stricter', () => {
  assert.equal(shelfLife('Ton offre se vend mal', 'news'), 'news');
  assert.equal(shelfLife('OpenClaw est mort', 'evergreen'), 'news');
});

test('an old launch video is stale, a recent one is not', () => {
  assert.equal(freshness('OpenClaw vient de sortir', null, '2026-04-01', now).stale, true);
  assert.equal(freshness('OpenClaw vient de sortir', null, '2026-10-25', now).stale, false);
});

test('tools age slower, principles barely', () => {
  assert.equal(freshness('Claude Code', null, '2026-09-01', now).stale, false);
  assert.equal(freshness('Claude Code', null, '2026-03-01', now).stale, true);
  assert.equal(freshness('Vends plus cher ton offre', null, '2026-01-01', now).stale, false);
  assert.equal(freshness('Vends plus cher ton offre', null, '2024-01-01', now).stale, true);
});

test('age is judged on the day of posting, so a clip can go stale while it waits', () => {
  assert.equal(freshness('Hermes', null, '2026-10-20', now).stale, false);
  assert.equal(freshness('Hermes', null, '2026-10-20', new Date(2026, 11, 20)).stale, true);
});

test('a missing date does not bury the clip', () => {
  assert.equal(freshness('OpenClaw', null, null, now).stale, false);
  assert.equal(ageInDays('2026-11-01', now), 4);
  assert.equal(parseUploadDate('20260921'), '2026-09-21');
  assert.equal(parseUploadDate('NA'), null);
});

const clip = (id: string, o: { manual?: boolean; uploaded?: boolean; stale?: boolean; note?: number }) => ({ id, manual: Boolean(o.manual), uploaded: Boolean(o.uploaded), stale: Boolean(o.stale), note: o.note ?? 50 });

test('stale clips go last, even with a much better note', () => {
  const sorted = [clip('oldGreat', { stale: true, note: 99 }), clip('freshOk', { note: 40 }), clip('oldBad', { stale: true, note: 10 })].sort(byPriority).map((c) => c.id);
  assert.deepEqual(sorted, ['freshOk', 'oldGreat', 'oldBad']);
  assert.equal(tier(clip('x', { stale: true })), -1);
});

test('what he validated or uploaded himself is never demoted for its age', () => {
  assert.equal(tier(clip('x', { stale: true, manual: true })), 2);
  assert.equal(tier(clip('x', { stale: true, uploaded: true })), 1);
});

test('automatic validation takes stale clips only when nothing fresh is left', () => {
  const reviewable = [{ ...clip('old', { stale: true, note: 95 }), qa: 'pass' }, { ...clip('fresh', { note: 60 }), qa: 'pass' }];
  assert.deepEqual(pickAutoApprovals({ reviewable, approvedWaiting: 0, slotsToFill: 1, minNote: 50, allowWarnings: false }), ['fresh']);
  assert.deepEqual(pickAutoApprovals({ reviewable, approvedWaiting: 0, slotsToFill: 2, minNote: 50, allowWarnings: false }), ['fresh', 'old']);
});

test('a fresh clip takes the slot of a stale one, not of another fresh one', () => {
  const now2 = new Date(2026, 10, 5, 10);
  const booked = (pubId: string, stale: boolean, hour: number) => ({ ...clip(pubId, { stale }), pubId, at: new Date(2026, 10, 5, hour) });
  assert.deepEqual(pickEvictions([clip('fresh', {})], [booked('freshHeld', false, 12), booked('old', true, 15)], now2), ['old']);
  assert.deepEqual(pickEvictions([clip('fresh', {})], [booked('freshHeld', false, 12)], now2), []);
  assert.deepEqual(pickEvictions([clip('oldToo', { stale: true })], [booked('old', true, 15)], now2), []);
});
