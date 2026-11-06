import test from 'node:test';
import assert from 'node:assert/strict';
import { JITTER_MINUTES, planPublications, type PlanOptions } from '../src/lib/planner.ts';

const o = (over: Partial<PlanOptions> = {}): PlanOptions => ({ now: new Date(2026, 10, 5, 8, 0), startHour: 9, endHour: 21, minGapHours: 3, horizonDays: 7, ...over });
const ig = (id: string, maxPerDay = 3) => ({ id, provider: 'instagram', maxPerDay });
const clips = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, score: 100 - i }));

test('respects the daily cap and the minimum gap on a channel', () => {
  const plan = planPublications(clips(7), [ig('a')], [], o());
  const day1 = plan.filter((p) => p.at.getDate() === 5);
  assert.equal(day1.length, 3);
  const times = plan.map((p) => p.at.getTime()).sort((x, y) => x - y);
  times.slice(1).forEach((t, i) => assert.ok(t - times[i]! >= 3 * 3_600_000));
});

test('best clips get the earliest slots', () => {
  const plan = planPublications([{ id: 'low', score: 10 }, { id: 'high', score: 90 }], [ig('a')], [], o());
  const at = (id: string) => plan.find((p) => p.clipId === id)!.at.getTime();
  assert.ok(at('high') < at('low'));
});

test('a clip goes once per network, never on two accounts of the same network', () => {
  const plan = planPublications(clips(1), [ig('a'), ig('b'), { id: 'yt', provider: 'youtube', maxPerDay: 2 }, { id: 'st', provider: 'instagram-standalone', maxPerDay: 2 }], [], o());
  assert.equal(plan.length, 2);
  assert.equal(plan.filter((p) => p.channelId === 'yt').length, 1);
  assert.equal(plan.filter((p) => ['a', 'b', 'st'].includes(p.channelId)).length, 1);
});

test('slots stay inside the posting window', () => {
  for (const p of planPublications(clips(10), [ig('a')], [], o())) {
    assert.ok(p.at.getHours() >= 9 && p.at.getHours() <= 21);
  }
});

test('never plans in the past and skips what is already booked', () => {
  const late = new Date(2026, 10, 5, 20, 50);
  const plan = planPublications(clips(1), [ig('a')], [], o({ now: late }));
  assert.ok(plan[0]!.at > late);
  const booked = [{ clipId: 'x', channelId: 'a', at: new Date(2026, 10, 5, 9, 0) }];
  const next = planPublications(clips(1), [ig('a')], booked, o());
  assert.ok(next[0]!.at.getTime() - booked[0]!.at.getTime() >= 3 * 3_600_000);
});

test('a clip already booked on a network is not planned there again', () => {
  const booked = [{ clipId: 'c0', channelId: 'a', at: new Date(2026, 10, 6, 9, 0) }];
  assert.equal(planPublications(clips(1), [ig('a'), ig('b')], booked, o()).length, 0);
});

test('stops at the horizon instead of planning forever', () => {
  const plan = planPublications(clips(50), [ig('a', 1)], [], o({ horizonDays: 3 }));
  assert.equal(plan.length, 3);
});

test('the volume per day decides how many clips go out, spread over the day', () => {
  const plan = planPublications(clips(20), [ig('a', 99)], [], o({ volumeOn: () => 6, minGapHours: 1, horizonDays: 1 }));
  assert.equal(plan.length, 6);
  const hours = plan.map((p) => p.at.getHours() + p.at.getMinutes() / 60).sort((x, y) => x - y);
  assert.ok(hours.at(-1)! - hours[0]! >= 8, 'spread over the window, not bunched');
});

test('volume grows from one day to the next', () => {
  const start = new Date(2026, 10, 5, 8, 0).getDate();
  const plan = planPublications(clips(30), [ig('a', 99)], [], o({ volumeOn: (d) => (d.getDate() === start ? 3 : 5), minGapHours: 1, horizonDays: 2 }));
  assert.equal(plan.filter((p) => p.at.getDate() === start).length, 3);
  assert.equal(plan.filter((p) => p.at.getDate() === start + 1).length, 5);
});

test('accounts on one network share the volume, each within its cap', () => {
  const plan = planPublications(clips(30), [ig('a', 99), ig('b', 1)], [], o({ volumeOn: () => 6, minGapHours: 1, horizonDays: 1 }));
  assert.equal(plan.filter((p) => p.channelId === 'a').length, 3);
  assert.equal(plan.filter((p) => p.channelId === 'b').length, 1);
});

const minutes = (d: Date) => d.getHours() * 60 + d.getMinutes();

test('posts stay within 35 minutes of their evenly spread slot', () => {
  const plan = planPublications(clips(6), [ig('a', 99)], [], o({ volumeOn: () => 6, minGapHours: 1, horizonDays: 1 }));
  const times = plan.map((p) => minutes(p.at)).sort((x, y) => x - y);
  times.forEach((t, k) => {
    const center = 9 * 60 + (k + 0.5) * 120;   // 12 h window, 6 posts: every 2 h
    assert.ok(Math.abs(t - center) <= JITTER_MINUTES, `slot ${k}: ${t} vs ${center}`);
  });
});

test('the schedule is not machine-regular: no constant interval, no round times', () => {
  const plan = planPublications(clips(6), [ig('a', 99)], [], o({ volumeOn: () => 6, minGapHours: 1, horizonDays: 1 }));
  const times = plan.map((p) => minutes(p.at)).sort((x, y) => x - y);
  const gaps = times.slice(1).map((t, i) => t - times[i]!);
  assert.ok(new Set(gaps).size > 1, `intervals: ${gaps}`);
  assert.ok(plan.filter((p) => p.at.getMinutes() % 15 === 0).length < plan.length, 'not all on the quarter hour');
});

test('two days and two accounts do not share the same times', () => {
  const plan = planPublications(clips(12), [ig('a', 99)], [], o({ volumeOn: () => 6, minGapHours: 1, horizonDays: 2 }));
  const dayOf = (n: number) => plan.filter((p) => p.at.getDate() === n).map((p) => minutes(p.at)).sort((x, y) => x - y);
  assert.notDeepEqual(dayOf(5), dayOf(6));
  const two = planPublications(clips(2), [ig('a', 99), { id: 'tt', provider: 'tiktok', maxPerDay: 99 }], [], o({ volumeOn: () => 2, minGapHours: 1, horizonDays: 1 }));
  const at = (id: string) => two.filter((p) => p.channelId === id).map((p) => minutes(p.at));
  assert.notDeepEqual(at('a'), at('tt'));
});

test('a replan keeps the same times, and booked posts keep their slot', () => {
  const first = planPublications(clips(6), [ig('a', 99)], [], o({ volumeOn: () => 6, minGapHours: 1, horizonDays: 1 }));
  const again = planPublications(clips(6), [ig('a', 99)], [], o({ volumeOn: () => 6, minGapHours: 1, horizonDays: 1 }));
  assert.deepEqual(first.map((p) => p.at.getTime()), again.map((p) => p.at.getTime()));
  const booked = first.slice(0, 2).map((p) => ({ clipId: p.clipId, channelId: p.channelId, at: p.at }));
  const rest = planPublications(clips(6).slice(2), [ig('a', 99)], booked, o({ volumeOn: () => 6, minGapHours: 1, horizonDays: 1 }));
  assert.equal(rest.length, 4);
  assert.deepEqual(rest.map((p) => p.at.getTime()).sort(), first.slice(2).map((p) => p.at.getTime()).sort());
});

test('the minimum gap always wins over the jitter, even at high volume', () => {
  const plan = planPublications(clips(30), [ig('a', 99)], [], o({ volumeOn: () => 20, minGapHours: 0.5, horizonDays: 1 }));
  const times = plan.map((p) => p.at.getTime()).sort((x, y) => x - y);
  times.slice(1).forEach((t, i) => assert.ok(t - times[i]! >= 0.5 * 3_600_000 * 0.999));
  assert.ok(plan.length > 0);
});

test('an urgent clip arriving mid-day gets the next open slot, not tomorrow', () => {
  const now = new Date(2026, 10, 5, 13, 0);
  const plan = planPublications(clips(1), [ig('a', 99)], [], o({ now, volumeOn: () => 6, minGapHours: 1, horizonDays: 2 }));
  assert.equal(plan[0]!.at.getDate(), 5);
  assert.ok(plan[0]!.at.getTime() - now.getTime() < 2 * 3_600_000);
});

test('a format only goes to the accounts chosen for it', () => {
  const channels = [ig('insta', 99), { id: 'tt', provider: 'tiktok', maxPerDay: 99 }];
  const plan = planPublications([{ id: 'c', score: 1, channels: ['tt'] }, { id: 'd', score: 1 }], channels, [], o({ volumeOn: () => 6, minGapHours: 1, horizonDays: 1 }));
  assert.deepEqual(plan.filter((p) => p.clipId === 'c').map((p) => p.channelId), ['tt']);
  assert.deepEqual(plan.filter((p) => p.clipId === 'd').map((p) => p.channelId).sort(), ['insta', 'tt']);
});

test('a format with no account chosen is never planned', () => {
  assert.equal(planPublications([{ id: 'c', score: 1, channels: [] }], [ig('a', 99)], [], o()).length, 0);
});

test('an account with its own volume gets its own number of posts, the others keep the general one', async () => {
  const { planPublications } = await import('../src/lib/planner.ts');
  const clips = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, score: 100 - i }));
  const now = new Date(2026, 10, 6, 6, 0);
  const plan = planPublications(clips, [
    { id: 'ig', provider: 'instagram', maxPerDay: 50 },
    { id: 'yt', provider: 'youtube', maxPerDay: 50, volumeOn: () => 10 },
  ], [], { now, startHour: 9, endHour: 21, minGapHours: 0.5, horizonDays: 1, volumeOn: () => 6 });
  const day = (id: string) => plan.filter((p) => p.channelId === id && p.at.getDate() === 6).length;
  assert.equal(day('ig'), 6);
  assert.equal(day('yt'), 10);
  // the best clips go everywhere: the 6 on Instagram are also on YouTube
  const ig = new Set(plan.filter((p) => p.channelId === 'ig').map((p) => p.clipId));
  assert.ok([...ig].every((id) => plan.some((p) => p.channelId === 'yt' && p.clipId === id)));
});
