import test from 'node:test';
import assert from 'node:assert/strict';
import { checkFrames, compareAudio, judgeAudio, judgeTech, judgeTics, norm, qaStatus } from '../src/lib/qa-rules.ts';

const words = (s: string, start = 0, step = 0.4) => s.split(' ').map((text, i) => ({ text, start: start + i * step, end: start + i * step + 0.3 }));
const SENT = "ok donc on a stoppé les campagnes parce que ça ne convertit pas du tout franchement";

test('normalisation ignores accents, case and punctuation', () => {
  assert.equal(norm("L'Été, à 100 % !"), 'l ete a 100');
});

test('identical audio and captions pass', () => {
  const r = compareAudio(words(SENT), words(SENT));
  assert.equal(r.recall, 1);
  assert.ok(r.firstOk && r.lastOk);
  assert.equal(r.syncMedian, 0);
  assert.deepEqual(judgeAudio(r), []);
});

test('a clipped start and end are flagged', () => {
  const w = SENT.split(' ');
  const r = compareAudio(words(SENT), words(w.slice(4, -4).join(' ')));
  assert.equal(r.firstOk, false);
  assert.equal(r.lastOk, false);
  assert.ok(judgeAudio(r).some((f) => f.code === 'start-clipped'));
  assert.ok(judgeAudio(r).some((f) => f.code === 'end-clipped'));
});

test('captions drifting from the voice are a failure', () => {
  const r = compareAudio(words(SENT, 0.6), words(SENT));
  assert.ok(Math.abs(r.syncMedian - 0.6) < 0.001);
  assert.equal(qaStatus(judgeAudio(r)), 'fail');
});

test('audio that lost most of its words fails', () => {
  const r = compareAudio(words(SENT), words('ok franchement'));
  assert.equal(qaStatus(judgeAudio(r)), 'fail');
});

const cap = (text: string, y: number, x = 300) => ({ text, conf: 1, x, y, w: 480, h: 60 });

test('caption seen while spoken counts as readable, missing does not', () => {
  const captions = [{ text: 'campagnes', start: 1, end: 1.4 }];
  assert.equal(checkFrames([{ t: 1.1, texts: [cap('CAMPAGNES', 1100)] }], { captions }).readableShare, 1);
  const missing = checkFrames([{ t: 1.1, texts: [] }], { captions });
  assert.equal(missing.readableShare, 0);
  assert.equal(qaStatus(missing.findings), 'fail');
});

test('text outside the safe zones is reported', () => {
  const r = checkFrames([{ t: 0, texts: [cap('haut', 100), cap('bas', 1600), { ...cap('droite', 1000), x: 900 }] }], { captions: [] });
  assert.equal(r.unsafe, 3);
  assert.equal(r.findings[0]!.code, 'safe-zone');
});

test('captions on the mouth are reported, not when clear of it', () => {
  const mouth = { x: 400, y: 900, w: 200, h: 60 };
  assert.ok(checkFrames([{ t: 0, mouth, texts: [cap('mot', 910)] }], { captions: [] }).findings.some((f) => f.code === 'mouth'));
  assert.equal(checkFrames([{ t: 0, mouth, texts: [cap('mot', 1200)] }], { captions: [] }).mouthCovered, 0);
});

test('text inside a shared screen is footage, not ours', () => {
  const contentRect = { x: 0, y: 656, w: 1080, h: 608 };
  const r = checkFrames([{ t: 0, texts: [{ ...cap('doc', 800), x: 950, w: 130 }] }], { captions: [], contentRect });
  assert.equal(r.unsafe, 0);
  const below = checkFrames([{ t: 0, texts: [cap('sous-titre', 1320)] }], { captions: [], contentRect });
  assert.equal(below.unsafe, 0);
});

test('technical rules', () => {
  const ok = { width: 1080, height: 1920, codec: 'h264', duration: 30, lufs: -14, truePeak: -1.4, longestSilence: 0.3, blackSeconds: 0 };
  assert.deepEqual(judgeTech(ok), []);
  assert.equal(qaStatus(judgeTech({ ...ok, width: 720 })), 'fail');
  assert.equal(qaStatus(judgeTech({ ...ok, blackSeconds: 2 })), 'fail');
  assert.equal(qaStatus(judgeTech({ ...ok, lufs: -24 })), 'warn');
  assert.equal(qaStatus(judgeTech({ ...ok, longestSilence: 3 })), 'warn');
});

test('captions placed over a shared screen still count as readable', () => {
  const contentRect = { x: 0, y: 656, w: 1080, h: 608 };
  const r = checkFrames([{ t: 1.1, texts: [cap('campagnes', 900)] }], { captions: [{ text: 'campagnes', start: 1, end: 1.4 }], contentRect });
  assert.equal(r.readableShare, 1);
});

test('remaining tics and overly long clips are reported', () => {
  assert.deepEqual(judgeTics(0, 30), []);
  assert.equal(judgeTics(4, 30)[0]!.code, 'tics');
  assert.ok(judgeTics(0, 70).some((f) => f.code === 'long'));
});
