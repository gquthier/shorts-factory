import { z } from 'zod';
import { hookProblem } from './selection.ts';

export const HookCandidate = z.object({
  text: z.string(), type: z.string(), viewer_question: z.string().min(8), payoff_quote: z.string().min(12),
});
const grade = z.number().finite().min(0).max(5);
export const HookJudgment = z.object({
  index: z.number().int().nonnegative(), time_to_claim: grade, specificity: grade, open_loop: grade,
  relevance: grade, complement: grade, payoff: grade, charge: grade, sendable: grade,
  clarity: grade, icp: grade, faithfulness: grade, voice: grade, coherence: grade,
});
export const HOOK_WEIGHTS = { time_to_claim: 15, specificity: 15, open_loop: 25, relevance: 10, complement: 10, payoff: 10, charge: 10, sendable: 5 } as const;
export const weightedScore = (s: Record<keyof typeof HOOK_WEIGHTS, number>) =>
  Object.entries(HOOK_WEIGHTS).reduce((sum, [k, w]) => sum + (Math.min(5, Math.max(0, s[k as keyof typeof HOOK_WEIGHTS])) / 5) * w, 0);
const plain = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
export function groundedHook(h: z.infer<typeof HookCandidate>, transcript: string): string | null {
  const problem = hookProblem(h.text, transcript);
  if (problem) return problem;
  if (!h.viewer_question?.trim()) return 'no concrete viewer question';
  if (!h.payoff_quote || plain(h.payoff_quote).length < 12 || !plain(transcript).includes(plain(h.payoff_quote))) return 'payoff quote is not in the clip';
  return null;
}
export function rankHooks<T extends { text: string; type: string }>(hooks: T[], raw: z.infer<typeof HookJudgment>[]) {
  return hooks.map((h, i) => {
    const matches = raw.filter(s => s.index === i);
    const s = matches.length === 1 ? HookJudgment.safeParse(matches[0]) : null;
    const score = s?.success && ['clarity', 'icp', 'faithfulness', 'voice', 'coherence', 'payoff'].every(k => s.data[k as keyof typeof s.data] >= 3)
      && s.data.open_loop >= 2 ? Math.round(weightedScore(s.data)) : 0;
    return { ...h, score };
  }).sort((a, b) => b.score - a.score);
}

export function hookWritingTask(clip: { transcript: string; title: string; published_at: string | null }, today: string): string {
  return `<clip>\n${clip.transcript}\n</clip>\nSujet : ${clip.title}
Date source : ${clip.published_at ?? 'inconnue'}. Aujourd'hui : ${today}. Ne présente jamais une ancienne sortie comme une nouveauté.

Lis d'abord le clip : quel problème précis le spectateur reconnaît-il, quelle croyance est mise en défaut, quelle explication ou preuve existe vraiment ?
Écris 6 propositions naturelles de texte à l'écran. Explore 2 ou 3 mécanismes qui conviennent au clip, avec des variantes de formulation. Ne force ni chiffre, ni choc, ni contradiction. Les exemples de l'étude sont des observations, pas des phrases à recycler.
Pour chaque proposition :
- text : idéalement 5 à 11 mots, au maximum 13. Un sujet identifiable, un enjeu concret. Une phrase que le créateur pourrait dire. Un outil n'est nommé que s'il est réellement central.
- type : la mécanique choisie.
- viewer_question : la question PRÉCISE que ce titre fait naître. « Je veux la suite » ne compte pas. Exemple de structure : pourquoi ce résultat malgré cette action, quelle étape manque, comment fait-il concrètement ?
- payoff_quote : une courte citation EXACTE du clip qui permet de répondre. Garde les mots et la ponctuation de la transcription. Pas de preuve importée d'un autre créateur.

Test du duo : relis le texte avec les premiers mots prononcés du clip. Est-ce le même sujet ? Comprend-on qui fait quoi et pourquoi cela nous concerne ? Le titre doit donner le contexte manquant, sans paraphraser toute la conclusion. Il peut annoncer un résultat si la manière de l'obtenir reste à comprendre. Ne cache jamais le sujet derrière « ça », « ce truc » ou « cette erreur » seuls.
Crée la curiosité par un détail vrai, un contraste, un coût concret, une étape invisible ou une démonstration attendue. Pas par une phrase absurde, une attaque gratuite ou une promesse sans preuve. Ne force pas un scandale ou une histoire personnelle dans un tuto.
Si le clip n'a pas de tension spectaculaire, préfère une question utile à un faux choc. Conserve les nuances (« parfois », « chez moi », « peut »). Pas de généralisation d'un cas personnel.

Donne aussi :
- emph : 1 à 6 mots exacts qui portent l'idée.
- replacements : uniquement erreurs de transcription évidentes ou nombres en lettres à passer en chiffres. Ne réécris jamais une phrase.
- beats : 3 à 6 idées à afficher, une toutes les 4 à 8 secondes. phrase = 1 à 4 mots EXACTS prononcés ; text = 1 à 4 mots à l'écran ; kind = stat, tool ou label. Aucun chiffre absent du clip.
- shelf_life : news pour une actu précise, trend pour une tactique du moment, evergreen sinon.`;
}

export const HOOK_JUDGE_CRITERIA = `Note chaque hook de 0 à 5. 3 est déjà bon.
time_to_claim : enjeu lisible immédiatement ; specificity : sujet/détail concret ; open_loop : une question précise à résoudre, pas du flou ; relevance : bénéfice pour la cible ; complement : le texte contextualise ou ajoute une tension aux premiers mots ; payoff : la vidéo répond vraiment ; charge : surprise ou tension utile ; sendable : intérêt à partager.
VETO : clarity (compris au premier regard), icp (pertinent pour la cible), faithfulness (aucune causalité, certitude, promesse ou chiffre ajouté), voice (le créateur, direct et concret, jamais slogan de coach), coherence (texte et début oral parlent du même problème), payoff (réponse présente). Un score inférieur à 3 sur un veto élimine le hook, même s'il attire des clics.
Ne récompense pas le simple nombre de mots forts ou de chiffres. Une formulation claire qui promet une explication concrète peut être meilleure qu'une provocation. Un titre qui donne déjà la solution complète sans raison d'écouter obtient au maximum 1 en open_loop. Compare les 6 propositions avant de noter ; ne leur donne pas toutes la même note.`;
