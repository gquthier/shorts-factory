import test from 'node:test';
import assert from 'node:assert/strict';
import { alignBounds, applyShortening, clausesFromWords, cutsBetween, snapToSentences, trimOpening } from '../src/lib/shorten.ts';

const words = (s: string, step = 0.5) => s.split(' ').map((text, i) => ({ text, start: i * step, end: i * step + 0.4 }));
const TEXT = 'On a stoppé les campagnes, parce que ça coûte cher, et je raconte ma vie, pour rien du tout, le résultat est clair.';

test('clauses split on punctuation', () => {
  const c = clausesFromWords(words(TEXT));
  assert.deepEqual(c.map((x) => x.text), ['On a stoppé les campagnes,', 'parce que ça coûte cher,', 'et je raconte ma vie,', 'pour rien du tout,', 'le résultat est clair.']);
});

test('a very long run without punctuation is still split', () => {
  assert.equal(clausesFromWords(words(Array.from({ length: 50 }, () => 'mot').join(' ')), 22).length, 3);
});

test('removes what was proposed and reports the new length', () => {
  const c = clausesFromWords(words(TEXT));
  const r = applyShortening(c, [2, 3], { minSeconds: 1 });
  assert.equal(r.applied, true);
  assert.deepEqual(r.kept.map((x) => x.i), [0, 1, 4]);
  assert.deepEqual(r.dropped.map((x) => x.i), [2, 3]);
  assert.ok(r.seconds < c.reduce((s, x) => s + x.end - x.start, 0));
});

test('never opens on a clause that needs what came before', () => {
  const c = clausesFromWords(words('Le début normal, et la suite ici, pour la fin claire.'));
  const r = applyShortening(c, [0], { minSeconds: 0.1 });
  assert.equal(r.applied, false);
});

test('moves the ending back to a finished sentence', () => {
  const c = clausesFromWords(words('Une phrase finie ici. Une autre phrase finie. Un bout qui traîne,'));
  const r = applyShortening(c, [1], { minSeconds: 0.1 });
  assert.equal(r.applied, false, 'a single clause left is refused');
  const c2 = clausesFromWords(words('Une phrase ici. Une deuxième ici. Encore une ici. Un bout qui traîne, encore un,'));
  const r2 = applyShortening(c2, [1], { minSeconds: 0.1, maxRemovedShare: 0.9 });
  assert.deepEqual(r2.kept.map((x) => x.i), [0, 2]);
});

test('refuses a result that is too short or too heavily cut', () => {
  const c = clausesFromWords(words(TEXT));
  assert.equal(applyShortening(c, [1, 2, 3], { minSeconds: 30 }).applied, false);
  assert.equal(applyShortening(c, [1, 2, 3], { minSeconds: 0.1, maxRemovedShare: 0.2 }).applied, false);
});

test('ignores invalid indexes from the model', () => {
  const c = clausesFromWords(words(TEXT));
  assert.equal(applyShortening(c, [99, -1, 1.5], { minSeconds: 1 }).applied, false);
});

test('cuts only the gaps between kept clauses', () => {
  const w = words(TEXT);
  const c = clausesFromWords(w);
  const { kept } = applyShortening(c, [2, 3], { minSeconds: 1 });
  const cuts = cutsBetween(kept, w);
  assert.equal(cuts.length, 1);
  assert.equal(cuts[0]![0], c[1]!.end);
  assert.equal(cuts[0]![1], c[4]!.start);
});

const textOf = (w: { text: string }[]) => w.map((x) => x.text).join(' ');

test('finds the true bounds of a moment by text, whatever the rough timing said', () => {
  const w = words("avant ça. On est à 12 k sur le SaaS, officiellement. C'est tout pour moi. Et après on change");
  const got = alignBounds(w, "On est à 12 k sur le SaaS, officiellement. C'est tout pour moi.", { start: 90, end: 99 });
  assert.equal(textOf(got), "On est à 12 k sur le SaaS, officiellement. C'est tout pour moi.");
});

test('falls back on time when the text cannot be matched', () => {
  const w = words('un deux trois quatre');
  assert.equal(textOf(alignBounds(w, 'rien à voir du tout', { start: 0.4, end: 1.3 })), 'deux trois');
});

test('a clip opens on the idea, not on a connector or a stray fragment', () => {
  assert.equal(textOf(trimOpening(words('Donc, ça te laisse le temps de bosser'))), 'ça te laisse le temps de bosser');
  assert.equal(textOf(trimOpening(words('Mais ton focus reste le même partout'))), 'ton focus reste le même partout');
  assert.equal(textOf(trimOpening(words("mastermind, masterclass, bref, peu importe, ce qui va primer c'est toi"))), "ce qui va primer c'est toi");
  assert.equal(textOf(trimOpening(words('Une boîte, ça marche comme une machine'))), 'ça marche comme une machine');
  assert.equal(textOf(trimOpening(words('On a stoppé les campagnes hier soir'))), 'On a stoppé les campagnes hier soir');
});

test('a clip ends on a finished sentence, not mid-phrase', () => {
  const all = words('Une première phrase assez longue ici pour tenir. Une deuxième phrase qui finit bien. Et puis elle part comme ça sans finir vraiment');
  const bounded = all.slice(0, all.length - 1);
  assert.equal(textOf(snapToSentences(all, bounded, 1)), 'Une première phrase assez longue ici pour tenir. Une deuxième phrase qui finit bien.');
});

test('if going back leaves too little, the ending goes forward to the sentence end', () => {
  const all = words('Une phrase courte. Elle continue encore un peu ici et finit là. Suite');
  const bounded = all.slice(0, 7);
  assert.equal(textOf(snapToSentences(all, bounded, 3)), 'Une phrase courte. Elle continue encore un peu ici et finit là.');
});

test('a clip opening mid-phrase moves to the next sentence start', () => {
  const all = words('Avant. mot faire des deals gros. Les gros poissons ne viennent pas seuls sur ton funnel du tout.');
  const bounded = all.slice(2);
  assert.equal(textOf(snapToSentences(all, bounded, 1)), 'Les gros poissons ne viennent pas seuls sur ton funnel du tout.');
});

test('a clip already on sentences does not move, and a long lead-in is left alone', () => {
  const all = words('Avant. On reste bien ici jusqu au bout. Après.');
  assert.equal(textOf(snapToSentences(all, all.slice(1, 8), 1)), 'On reste bien ici jusqu au bout.');
});
