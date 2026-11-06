import test from 'node:test';
import assert from 'node:assert/strict';
import { assignToAccounts, dedupeClips, hookProblem, pickTemplate } from '../src/lib/selection.ts';
import { cropExpr, planShots } from '../src/lib/reframe.ts';
import { ticIndexes } from '../src/lib/tics.ts';
import { isScreenShare } from '../src/lib/render.ts';
import { applyGlossary } from '../src/stages/hook.ts';

test('dedupe keeps the stronger of two overlapping clips', () => {
  const out = dedupeClips([{ start: 0, end: 30, standalone: 6 }, { start: 5, end: 35, standalone: 9 }, { start: 40, end: 60, standalone: 7 }]);
  assert.deepEqual(out.map((c) => c.standalone), [9, 7]);
});

test('hook with a figure the speaker never said is rejected', () => {
  assert.match(hookProblem('Il a fait 50 000 € en un mois', 'j\'ai dépensé 213 euros en 10 jours')!, /figure/);
  assert.equal(hookProblem('213 € en 10 jours : mon verdict', 'j\'ai dépensé 213 euros en 10 jours'), null);
});

test('thousands separators count as the same figure', () => {
  assert.equal(hookProblem('Je facture 12 000 € d\'avance', 'je facture 12000 euros'), null);
  assert.equal(hookProblem('Je facture 12000 € d\'avance', 'je facture 12 000 euros'), null);
});

test('a figure said in words counts as said', () => {
  assert.equal(hookProblem('Je fais 4 calls par semaine', 'je vais faire quatre calls semaine'), null);
});

test('hook style rules', () => {
  assert.equal(hookProblem('Découvre le secret des ads', ''), 'banned phrase');
  assert.equal(hookProblem('Arrête de faire ça maintenant !', ''), 'exclamation mark');
  assert.equal(hookProblem('ARRÊTE DE FAIRE ÇA', ''), 'all caps');
  assert.equal(hookProblem('Trop court', ''), 'too short');
  assert.equal(hookProblem('Arrête 🔥 de faire ça', ''), 'emoji');
});

test('template round robin skips missing ones and falls back', () => {
  assert.equal(pickTemplate(['a', 'b'], ['a', 'b'], 3), 'b');
  assert.equal(pickTemplate(['x', 'a'], ['a', 'b'], 5), 'a');
  assert.equal(pickTemplate(undefined, ['b'], 0), 'b');
  assert.throws(() => pickTemplate(['a'], [], 0));
});

test('accounts never exceed their daily cap, surplus goes to backlog', () => {
  const clips = Array.from({ length: 7 }, (_, i) => ({ id: `c${i}` }));
  const { assigned, backlog } = assignToAccounts(clips, [{ account: 'a', maxPerDay: 3 }, { account: 'b', maxPerDay: 2 }]);
  assert.equal(assigned.filter((c) => c.account === 'a').length, 3);
  assert.equal(assigned.filter((c) => c.account === 'b').length, 2);
  assert.equal(backlog.length, 2);
  assert.deepEqual(assigned.slice(0, 2).map((c) => c.account), ['a', 'b']);
});

test('virtual camera holds still inside the dead zone and cuts when the face leaves it', () => {
  const s = (t: number, cx: number) => ({ t, cx, cy: 300, w: 100, h: 100 });
  const samples = [s(0, 600), s(1, 610), s(2, 620), s(3, 900), s(4, 905), s(5, 900)];
  const shots = planShots(samples, { cropW: 400, srcW: 1280, dur: 6 });
  assert.equal(shots.length, 2);
  assert.equal(shots[0]!.x, 400);
  assert.equal(shots[1]!.x, 700);
  assert.equal(cropExpr(shots), `if(lt(t,${shots[0]!.to.toFixed(3)}),400,700)`);
});

test('virtual camera ignores a one-frame detection glitch', () => {
  const s = (t: number, cx: number) => ({ t, cx, cy: 300, w: 100, h: 100 });
  const shots = planShots([s(0, 600), s(2, 1100), s(2.5, 600), s(3, 600), s(4, 600)], { cropW: 400, srcW: 1280, dur: 5 });
  assert.equal(shots.length, 1);
});

test('crop never leaves the frame', () => {
  const shots = planShots([{ t: 0, cx: 10, cy: 0, w: 1, h: 1 }], { cropW: 400, srcW: 1280, dur: 2 });
  assert.equal(shots[0]!.x, 0);
});

test('standalone hesitations are cut, real words are not', () => {
  const w = (text: string, start: number) => ({ text, start, end: start + 0.3 });
  assert.deepEqual(ticIndexes([w('Alors', 0), w('euh,', 1), w('Euh', 2), w('heureux', 3)]), [1, 2]);
});

test('a small webcam or no face counts as a screen share', () => {
  assert.equal(isScreenShare({ faceH: 90, h: 720, detected: true }), true);
  assert.equal(isScreenShare({ faceH: 250, h: 720, detected: true }), false);
  assert.equal(isScreenShare({ faceH: 0, h: 720, detected: false }), true);
});

test('glossary fixes a mishearing without doubling the right term', () => {
  const g: [string, string][] = [['GPT Ads', 'ChatGPT Ads']];
  assert.equal(applyGlossary('113 clics sur GPT Ads', g), '113 clics sur ChatGPT Ads');
  assert.equal(applyGlossary('113 clics sur ChatGPT Ads', g), '113 clics sur ChatGPT Ads');
});

test('a description stays short, in his voice, and never invents a figure', async () => {
  const { captionProblem } = await import('../src/lib/selection.ts');
  const said = 'On a fait 113 clics pour zéro conversion, donc on a coupé.';
  assert.equal(captionProblem('113 clics pour rien (🥲)', said, 'Mon hook'), null);
  assert.equal(captionProblem("Le problème c'était pas le bouton", said, 'Mon hook'), null);
  assert.equal(captionProblem('Aucun débat.', said, 'Mon hook'), 'too short');
  assert.match(captionProblem('500 clics pour rien', said, 'Mon hook')!, /figure/);
  assert.equal(captionProblem('Voici comment couper tes campagnes', said, 'Mon hook'), 'banned phrase');
  assert.equal(captionProblem('Coupe tout ça maintenant #ads', said, 'Mon hook'), 'hashtag');
  assert.equal(captionProblem('Coupe tout ça — vraiment maintenant', said, 'Mon hook'), 'dash');
  assert.equal(captionProblem('x'.repeat(121), said, 'Mon hook'), 'too long');
  assert.equal(captionProblem('Mon *hook* ici vraiment', said, 'Mon hook ici vraiment'), 'same as the hook');
});

test('typo-depth groups the opening words like the reference: a short word rides with the next one', async () => {
  const { hookChunks } = await import('../templates/typo-depth/template.mjs');
  const w = (text: string, start: number) => ({ text, start, end: start + 0.3 });
  const chunks = hookChunks([w('Est-ce', 0), w('que', 0.3), w('je', 0.6), w('vais', 0.9), w('être', 1.2), w('suffisamment', 1.5), w('engagé.', 2.1), w('Après', 4.5)]);
  assert.deepEqual(chunks.map((c: { text: string }) => c.text), ['EST-CE', 'QUE JE', 'VAIS', 'ÊTRE', 'SUFFISAMMENT', 'ENGAGÉ']);
});
