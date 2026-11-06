import test from 'node:test';
import assert from 'node:assert/strict';
import { byPriority, daysToNextIncrease, pickAutoApprovals, pickEvictions, tier, volumeOn, type RankedClip } from '../src/lib/autopilot.ts';
import { hookTypeWeights, measuredWeights, viralNote } from '../src/lib/virality.ts';

const v = { start: 6, step: 1, everyDays: 3, max: 40, startDate: '2026-11-05' };
const day = (d: number) => new Date(2026, 10, d, 12);

test('volume: 6 a day, +1 every 3 days', () => {
  assert.equal(volumeOn(v, day(5)), 6);
  assert.equal(volumeOn(v, day(7)), 6);
  assert.equal(volumeOn(v, day(8)), 7);
  assert.equal(volumeOn(v, day(11)), 8);
});

test('volume: +1 every day, stopping at the ceiling', () => {
  const daily = { ...v, everyDays: 1, max: 8 };
  assert.equal(volumeOn(daily, day(6)), 7);
  assert.equal(volumeOn(daily, day(20)), 8);
});

test('volume does not grow without a step, nor before its start date', () => {
  assert.equal(volumeOn({ ...v, step: 0 }, day(25)), 6);
  assert.equal(volumeOn(v, new Date(2026, 9, 1)), 6);
});

test('next increase is announced, and disappears at the ceiling', () => {
  assert.equal(daysToNextIncrease(v, day(5)), 3);
  assert.equal(daysToNextIncrease(v, day(7)), 1);
  assert.equal(daysToNextIncrease({ ...v, max: 6 }, day(5)), null);
  assert.equal(daysToNextIncrease({ ...v, step: 0 }, day(5)), null);
});

const clip = (id: string, manual: boolean, uploaded: boolean, note: number): RankedClip => ({ id, manual, uploaded, note });

test('priority: hand-validated first, then uploads, then the note', () => {
  const sorted = [clip('auto99', false, false, 99), clip('upload10', false, true, 10), clip('manual5', true, false, 5), clip('manualUpload1', true, true, 1), clip('auto50', false, false, 50)].sort(byPriority).map((c) => c.id);
  assert.deepEqual(sorted, ['manualUpload1', 'manual5', 'upload10', 'auto99', 'auto50']);
  assert.equal(tier(clip('x', false, false, 1)), 0);
});

test('automatic validation only fills what hand-validated clips do not cover', () => {
  const reviewable = [{ ...clip('a', false, false, 90), qa: 'pass' }, { ...clip('b', false, false, 80), qa: 'pass' }, { ...clip('c', false, false, 70), qa: 'pass' }];
  assert.deepEqual(pickAutoApprovals({ reviewable, approvedWaiting: 6, slotsToFill: 6, minNote: 50, allowWarnings: false }), []);
  assert.deepEqual(pickAutoApprovals({ reviewable, approvedWaiting: 4, slotsToFill: 6, minNote: 50, allowWarnings: false }), ['a', 'b']);
});

test('automatic validation respects the minimum note and the quality check', () => {
  const reviewable = [{ ...clip('low', false, false, 40), qa: 'pass' }, { ...clip('warn', false, false, 90), qa: 'warn' }, { ...clip('fail', false, false, 95), qa: 'fail' }, { ...clip('ok', false, false, 60), qa: 'pass' }];
  assert.deepEqual(pickAutoApprovals({ reviewable, approvedWaiting: 0, slotsToFill: 9, minNote: 50, allowWarnings: false }), ['ok']);
  assert.deepEqual(pickAutoApprovals({ reviewable, approvedWaiting: 0, slotsToFill: 9, minNote: 50, allowWarnings: true }), ['warn', 'ok']);
});

test('uploads validate first when the queue runs dry', () => {
  const reviewable = [{ ...clip('yt', false, false, 90), qa: 'pass' }, { ...clip('mine', false, true, 55), qa: 'pass' }];
  assert.deepEqual(pickAutoApprovals({ reviewable, approvedWaiting: 0, slotsToFill: 1, minNote: 50, allowWarnings: false }), ['mine']);
});

const now = new Date(2026, 10, 5, 10);
const booked = (pubId: string, manual: boolean, uploaded: boolean, hour: number) => ({ ...clip(pubId, manual, uploaded, 50), pubId, at: new Date(2026, 10, 5, hour) });

test('an upload takes the earliest slot held by an ordinary clip', () => {
  assert.deepEqual(pickEvictions([clip('up', false, true, 10)], [booked('late', false, false, 20), booked('soon', false, false, 12)], now), ['soon']);
});

test('nothing is evicted for an ordinary clip, and hand-validated slots are safe', () => {
  assert.deepEqual(pickEvictions([clip('ordinary', false, false, 99)], [booked('a', false, false, 12)], now), []);
  assert.deepEqual(pickEvictions([clip('up', false, true, 10)], [booked('hand', true, false, 12), booked('upl', false, true, 13)], now), []);
});

test('a post about to leave is not touched', () => {
  assert.deepEqual(pickEvictions([clip('up', false, true, 10)], [booked('imminent', false, false, 10)], now), []);
});

const signals = { hookScore: 70, standalone: 8, hookType: 'interdit', text: 'Claude Code et les agents', seconds: 25, qaStatus: 'pass', tics: 0 };
const weights = hookTypeWeights([{ ratio: 80, hook_type: 'interdit', language: 'fr' }, { ratio: 4, hook_type: 'recit-tension', language: 'fr' }, { ratio: 3, hook_type: 'question-directe', language: 'en' }]);

test('hook types are weighted from the outlier study', () => {
  assert.equal(weights.interdit, 1);
  assert.ok(weights['recit-tension']! < 0.5);
});

test('a fresh creator gets no hardcoded preference for the original creator’s niche', () => {
  const on = viralNote(signals, weights);
  const off = viralNote({ ...signals, text: 'Ma recette de crêpes du dimanche' }, weights);
  assert.equal(on.score, off.score);
  assert.ok(on.why.some((w) => w.includes('pas encore de données')));
  assert.ok(off.why.some((w) => w.includes('pas encore de données')));
});

test('the note penalises length, warnings, leftover tics, and caps failures', () => {
  const base = viralNote(signals, weights).score;
  assert.ok(viralNote({ ...signals, seconds: 70 }, weights).score < base);
  assert.equal(viralNote({ ...signals, qaStatus: 'warn' }, weights).score, base - 5);
  assert.ok(viralNote({ ...signals, tics: 4 }, weights).score < base);
  assert.ok(viralNote({ ...signals, qaStatus: 'fail' }, weights).score <= 30);
});

test('his own measured results replace the study when available', () => {
  const measured = measuredWeights([{ type: 'recit-tension', n: 8, views: 50000 }, { type: 'interdit', n: 6, views: 500 }, { type: 'autre', n: 2, views: 999999 }]);
  assert.equal(measured.autre, undefined);
  const mine = viralNote({ ...signals, hookType: 'recit-tension' }, weights, measured);
  const study = viralNote({ ...signals, hookType: 'recit-tension' }, weights);
  assert.ok(mine.score > study.score);
  assert.ok(mine.why.some((w) => w.includes('tes stats')));
});

test('a fresh install has no promotional caption from another creator', async () => {
  const { DEFAULT_CAPTION } = await import('../src/lib/autopilot.ts');
  assert.equal(DEFAULT_CAPTION, '');
});
