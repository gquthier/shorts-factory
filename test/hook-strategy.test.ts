import test from 'node:test';
import assert from 'node:assert/strict';
import { rankHooks, groundedHook, HookJudgment, hookWritingTask } from '../src/lib/hook-strategy.ts';
const transcript = 'J’ai branché mes transcriptions de calls à mes agents. Ils récupèrent le contexte chaque matin. Mais je ne vérifie pas toujours ce qui a changé.';
const candidate = { text: 'Mes agents bossent la nuit, je perds le fil', type: 'consequence', viewer_question: 'Pourquoi perdre le fil si les agents font le travail ?', payoff_quote: 'Mais je ne vérifie pas toujours ce qui a changé.' };
const good = { index: 0, time_to_claim: 4, specificity: 4, open_loop: 4, relevance: 4, complement: 4, payoff: 4, charge: 4, sendable: 4, clarity: 4, icp: 4, faithfulness: 4, voice: 4, coherence: 4 };

test('curiosity cannot compensate for a false promise, wrong voice or disconnected opening', () => {
  for (const veto of ['payoff', 'faithfulness', 'voice', 'coherence', 'clarity', 'icp']) {
    const ranked = rankHooks([candidate, { ...candidate, text: 'Les calls donnent du contexte à mes agents' }], [{ ...good, [veto]: 2 }, { ...good, index: 1, open_loop: 3 }]);
    assert.equal(ranked[0]!.text, 'Les calls donnent du contexte à mes agents');
    assert.equal(ranked[1]!.score, 0);
  }
});
test('missing and duplicate judgments fail closed; bounds reject inflated scores', () => {
  assert.equal(rankHooks([candidate], [])[0]!.score, 0);
  assert.equal(rankHooks([candidate], [good, good])[0]!.score, 0);
  assert.throws(() => HookJudgment.parse({ ...good, open_loop: 500 }));
});
test('the payoff must quote real words and the hook still passes factual guards', () => {
  assert.equal(groundedHook(candidate, transcript), null);
  assert.match(groundedHook({ ...candidate, payoff_quote: 'Je fais 50 000 euros par mois' }, transcript)!, /payoff/);
  assert.match(groundedHook({ ...candidate, text: 'Mes agents font 5000 € pendant la nuit' }, transcript)!, /figure/);
  assert.match(groundedHook({ ...candidate, viewer_question: '' }, transcript)!, /question/);
});
test('writing task asks for a specific reason to watch, contextual coherence and no forced six formulas', () => {
  const prompt = hookWritingTask({ transcript, title: 'Agents', published_at: null }, '2026-11-06');
  assert.match(prompt, /viewer_question/); assert.match(prompt, /payoff_quote/);
  assert.match(prompt, /premiers mots/); assert.doesNotMatch(prompt, /6 mécaniques différentes/);
});
