import test from 'node:test';
import assert from 'node:assert/strict';
import { wordsFromWhisper, sentencesFromWords, remapWords, frenchSpacing, canOpenClip, snapRange, tightRange, silenceCuts, parseSilences, findPhrase } from '../src/lib/transcript.ts';

const tok = (text: string, from: number, to: number) => ({ text, offsets: { from, to } });

test('merges sub-word tokens and drops noise tokens', () => {
  const words = wordsFromWhisper({ transcription: [{ tokens: [tok('[_BEG_]', 0, 0), tok(' Bon', 0, 300), tok('jour', 300, 500), tok(' toi.', 600, 900)] }] });
  assert.deepEqual(words.map((w) => w.text), ['Bonjour', 'toi.']);
  assert.equal(words[0]!.end, 0.5);
});

test('keeps the timeline monotonic', () => {
  const words = wordsFromWhisper({ transcription: [{ tokens: [tok(' a', 0, 500), tok(' b', 400, 800)] }] });
  assert.ok(words[1]!.start >= words[0]!.end);
});

test('splits sentences on punctuation, long gaps and max length', () => {
  const w = (text: string, start: number) => ({ text, start, end: start + 0.2 });
  const s = sentencesFromWords([w('Salut.', 0), w('Ça', 0.3), w('va', 0.6), w('bien', 3), w('toi?', 3.3)]);
  assert.equal(s[2]!.boundary, 'full');
  assert.deepEqual(s.map((x) => x.text), ['Salut.', 'Ça va', 'bien toi?']);
  assert.equal(s[1]!.w0, 1);
  const long = sentencesFromWords(Array.from({ length: 10 }, (_, i) => w(`m${i}`, i * 0.2)), { maxWords: 4 });
  assert.equal(long.length, 3);
});

test('remaps words across assembled ranges (cold open then body)', () => {
  const words = [{ text: 'a', start: 10, end: 10.5 }, { text: 'b', start: 20, end: 20.5 }];
  const out = remapWords(words, [[20, 21], [10, 11]]);
  assert.deepEqual(out.map((x) => [x.text, x.start]), [['b', 0], ['a', 1]]);
});

test('french punctuation stays attached to the previous word', () => {
  assert.equal(frenchSpacing('213 € en 10 jours : mon verdict ?'), '213\u00A0€ en 10 jours\u00A0: mon verdict\u00A0?');
});

const w = (text: string, start: number) => ({ text, start, end: start + 0.2 });
const run = (n: number, from = 0) => Array.from({ length: n }, (_, i) => w(`mot${i}`, from + i * 0.25));

test('long comma runs break at a comma and mark the boundary', () => {
  const words = [...run(15), w('virgule,', 3.75), ...run(5, 4), w('fin.', 5.25)];
  const s = sentencesFromWords(words);
  assert.equal(s.length, 2);
  assert.equal(s[1]!.boundary, 'comma');
  assert.equal(s[1]!.ends, true);
  assert.equal(s[0]!.ends, false);
});

test('a run with no punctuation is cut at max length and marked unusable', () => {
  const s = sentencesFromWords(run(40), { maxWords: 32 });
  assert.equal(s[1]!.boundary, 'cut');
  assert.equal(canOpenClip(s[1]!), false);
});

test('a clip cannot open on a word that needs what came before', () => {
  const mk = (text: string) => ({ i: 0, text, start: 0, end: 1, w0: 0, w1: 0, boundary: 'comma' as const, ends: true });
  assert.equal(canOpenClip(mk('de psychopathe qui allaient')), false);
  assert.equal(canOpenClip(mk("qu'on a fait")), false);
  assert.equal(canOpenClip(mk('Le fait est que')), true);
  assert.equal(canOpenClip(mk('Mon job, c\'est simple')), true);
});

test('snapRange moves to the next usable opening and the last finished sentence', () => {
  const s = (i: number, text: string, boundary: 'full' | 'comma' | 'cut', ends: boolean) => ({ i, text, start: i * 10, end: i * 10 + 9, w0: 0, w1: 0, boundary, ends });
  const list = [s(0, 'de psycho', 'comma', false), s(1, 'Le fait est', 'comma', true), s(2, 'suite', 'full', true), s(3, 'encore', 'comma', false)];
  assert.deepEqual(snapRange(list, 0, 3, 15), { a: 1, b: 2 });
  assert.equal(snapRange(list, 0, 3, 40), null);
});

test('clip bounds never swallow the next sentence, the reported bug', () => {
  const list = [{ text: 'là.', start: 9.5, end: 10 }, { text: 'Et', start: 10.15, end: 10.3 }, { text: "c'est", start: 10.3, end: 10.5 }];
  const [, end] = tightRange(list, 5, 10);
  assert.ok(end >= 10 && end < 10.15);
  assert.equal(remapWords(list, [[5, end]]).at(-1)!.text, 'là.');
});

test('clip bounds keep air when the neighbours are far', () => {
  const list = [{ text: 'a', start: 1, end: 1.5 }, { text: 'b', start: 5, end: 6 }, { text: 'c', start: 9, end: 10 }];
  assert.deepEqual(tightRange(list, 5, 6), [4.9, 6.28]);
  assert.equal(tightRange(list, 0, 1.5)[0], 0);
});

test('clip bounds never start inside the previous word', () => {
  const list = [{ text: 'fin', start: 4, end: 4.98 }, { text: 'Debut', start: 5, end: 5.5 }];
  const [a] = tightRange(list, 5, 5.5);
  assert.ok(a >= 4.98 && a <= 5);
});

test('long pauses become cuts, short ones stay', () => {
  const log = '[silencedetect] silence_start: 2.5\n[silencedetect] silence_end: 4 | silence_duration: 1.5\n silence_start: 7\n silence_end: 7.2 | silence_duration: 0.2\n silence_start: 9';
  const s = parseSilences(log);
  assert.equal(s.length, 2);
  assert.deepEqual(silenceCuts(s), [[2.62, 3.88]]);
});

test('a clip never closes on a question or a trailing comma', () => {
  const list = [w('Pourquoi', 0), w('ça', 0.3), w('marche?', 0.6), w('Parce', 1), w('que', 1.2), w('voilà,', 1.4), w('et', 3), w('fin.', 3.3)];
  const s = sentencesFromWords(list);
  assert.equal(s.find((x) => x.text.endsWith('marche?'))!.ends, false);
  assert.equal(s.find((x) => x.text.endsWith('voilà,'))!.ends, false);
  assert.equal(s.at(-1)!.ends, true);
});

test('finds the word a visual must land on, across punctuation and accents', () => {
  const list = [w('On', 0), w('a', 0.5), w('fait', 1), w('113', 1.5), w('clics,', 2), w('zéro', 2.5), w('conversion.', 3)];
  assert.equal(findPhrase(list, '113 clics'), 1.5);
  assert.equal(findPhrase(list, 'zero conversion'), 2.5);
  assert.equal(findPhrase(list, 'pas dedans'), null);
  assert.equal(findPhrase(list, 'on', 0.1), null);
});
