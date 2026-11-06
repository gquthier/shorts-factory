import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateSeconds, unverifiedFigures } from '../src/stages/ideas.ts';

test('script timing ignores proof placeholders', () => {
  const words = Array.from({ length: 27 }, () => 'mot').join(' ');
  assert.equal(estimateSeconds(words), 10);
  assert.equal(estimateSeconds(`${words} [À VÉRIFIER : un très long chiffre avec beaucoup de mots dedans]`), 10);
});

test('figures in a script are flagged unless already marked for checking', () => {
  assert.deepEqual(unverifiedFigures(['Ce skill fait en 4 minutes le taf'], 'Rien [À VÉRIFIER : 250 000 €] ici.'), ['4 minutes']);
  assert.deepEqual(unverifiedFigures(['Aucun chiffre'], 'Toujours rien.'), []);
});
