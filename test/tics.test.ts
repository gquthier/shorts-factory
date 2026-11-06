import test from 'node:test';
import assert from 'node:assert/strict';
import { countTics, snapToQuiet, ticCuts, withoutTics } from '../src/lib/tics.ts';

const words = (s: string, step = 0.25) => s.split(' ').map((text, i) => ({ text, start: i * step, end: i * step + 0.2 }));
const kept = (s: string) => withoutTics(words(s)).map((w) => w.text).join(' ');

test('removes his real tics, taken from his transcripts', () => {
  assert.equal(kept("set des timelines, ok, j'ai fait un"), "set des timelines, j'ai fait un");
  assert.equal(kept('que la valeur, genre, surtout le premier'), 'que la valeur, surtout le premier');
  assert.equal(kept('le premier mois, tu vois, la valeur'), 'le premier mois, la valeur');
  assert.equal(kept("mais niveau valeur, voilà, c'est quand même"), "mais niveau valeur, c'est quand même");
  assert.equal(kept('sur 20 meetings, en fait, il faut juste'), 'sur 20 meetings, il faut juste');
  assert.equal(kept("t'as 21 jours, tu vois, ok, 21 jours,"), "t'as 21 jours, 21 jours,");
  assert.equal(kept("taux de conversion, enfin, un taux"), 'taux de conversion, un taux');
  assert.equal(kept('admettons, donc, enfin, vous voyez ce que je veux dire, on part'), 'admettons, donc, on part');
});

test('keeps the same words when they carry meaning', () => {
  for (const s of ['ce genre de truc', 'voilà ce que je fais', "c'est quoi ton coût", 'un bon produit facilement', 'tu vois le truc là', 'à quoi ça ressemble.', "c'est ok pour moi", 'en gros volume ici', 'il est enfin parti', 'un genre de plan']) {
    assert.equal(kept(s), s, s);
  }
});

test('recognises the clipped form that precise transcription hears', () => {
  assert.equal(kept("vraiment sympa. 'fin 12 K"), 'vraiment sympa. 12 K');
});

test('handles a question mark that whisper made a separate word', () => {
  assert.equal(kept('coach business, OK ? Coach infopreneur'), 'coach business, Coach infopreneur');
});

test('stammers keep one occurrence, real repeats keep their words', () => {
  assert.equal(kept('tous les, tous les clients'), 'tous les clients');
  assert.equal(kept('je, je pense que'), 'je pense que');
  assert.equal(kept('beaucoup trop early, beaucoup trop early ici'), 'beaucoup trop early ici');
});

test('a cut reaches its neighbours and never overlaps them', () => {
  const w = [{ text: 'mois,', start: 0, end: 0.4 }, { text: 'tu', start: 0.5, end: 0.6 }, { text: 'vois,', start: 0.6, end: 0.8 }, { text: 'la', start: 0.9, end: 1 }];
  const [c] = ticCuts(w);
  assert.ok(c![0] >= 0.4 && c![0] <= 0.5);
  assert.ok(c![1] >= 0.8 && c![1] <= 0.9);
});

test('consecutive tics make one cut', () => {
  assert.equal(ticCuts(words('fin, tu vois, ok, voilà, suite')).length, 1);
});

test('a cut boundary moves to the quietest instant nearby', () => {
  const db = Array.from({ length: 100 }, () => -10);
  db[52] = -60;
  assert.equal(snapToQuiet(db, 0.01, 0.5), 0.52);
  assert.equal(snapToQuiet(db, 0.01, 0.1), 0.1);
});

test('counts tics for the QA', () => {
  assert.equal(countTics(words('bien, ok, on y va, tu vois, ici')), 2);
});

test('a snapped cut never reaches into the next word', async () => {
  const { snapInward } = await import('../src/lib/tics.ts');
  // Quietest instants sit just outside the cut: it must stay where it is rather than clip the neighbours.
  const db = Array.from({ length: 200 }, (_, i) => (i === 95 || i === 125 ? -90 : i === 105 || i === 115 ? -60 : -20));
  assert.deepEqual(snapInward(db, 0.01, 1.0, 1.2), [1.05, 1.15]);
  assert.deepEqual(snapInward([-20, -20, -20], 0.01, 0.0, 0.02), [0, 0.02]);
});
