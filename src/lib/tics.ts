// Finds verbal tics to cut from a take. French filler-word heuristics; review cuts for each speaker.
// A word is only a tic when it stands alone between pauses: "ce genre de", "voilà ce que", "c'est quoi" and "tu vois le truc" carry meaning and stay.
import type { Word } from './transcript.ts';

const clean = (s: string) => s.toLowerCase().replace(/’/g, "'").replace(/[^\p{L}\p{N}'-]+/gu, '');
const hasPunct = (s: string) => /[,;:.!?…]["»)]?$/.test(s);
const isPunctOnly = (s: string) => !/[\p{L}\p{N}]/u.test(s);

// Always a tic when delimited by pauses or punctuation on at least one side.
const DELIMITED: string[][] = [
  ['tu', 'vois', 'ce', 'que', 'je', 'veux', 'dire'], ['vous', 'voyez', 'ce', 'que', 'je', 'veux', 'dire'], ['je', 'veux', 'dire'],
  ['tu', 'vois'], ['vous', 'voyez'], ['tu', 'sais'], ['vous', 'savez'], ['tu', 'comprends'], ['en', 'gros'], ['du', 'coup'], ['en', 'fait'], ['grosso', 'modo'],
  ['ok'], ['okay'], ['genre'], ['voilà'], ['mec'], ['hein'], ['quoi'], ['enfin'], ["'fin"], ['bon'], ['bah'], ['ben'], ['et', 'tout'], ['ou', 'quoi'],
];

// Words before these keep the candidate meaningful: "ce genre", "de quoi", "c'est ok".
const KEEP_AFTER: Record<string, RegExp> = {
  genre: /^(ce|un|une|le|la|mon|ton|son|quel|quelle|de|du|même|tout|ces|cette)$/,
  quoi: /^(de|à|sur|pour|en|par|avec|sans|c'est|est|ou|que|dans|vers)$/,
  ok: /^(c'est|est|pas|ça|bien|suis|es|sont|ai)$/,
  okay: /^(c'est|est|pas|ça|bien|suis|es|sont|ai)$/,
  enfin: /^(et|mais|ou|pour)$/,
  bon: /^(un|une|le|la|très|trop|si|plus|aussi|mon|ton|son|ce|de|du|des|les|c'est|est|pas|vraiment|hyper|super|ultra|assez|bien)$/,
  voilà: /^(et|me|te|nous|vous|le|la|les|en)$/,
};
// Words after these keep it meaningful: "voilà ce que", "genre de", "bon produit".
const KEEP_BEFORE: Record<string, RegExp> = {
  voilà: /^(ce|comment|pourquoi|mes|tes|ses|le|la|les|un|une|des|ma|ta|sa|mon|ton|son|ça|à|qui|que|où)$/,
  genre: /^(de|d'|des)$/,
  enfin: /^(de|à|un|une|le|la|les|je|on|tu|il|elle|ça)$/,
  bon: /^(produit|client|clients|moment|article|articles|exemple|prix|bout|sens|choix|résultats?|travail|taf|plan|signe)$/,
};

// "tu vois le truc" is a real sentence: these only count as tics when a pause follows.
const RIGHT_ONLY = new Set(['tu vois', 'vous voyez', 'tu sais', 'vous savez', 'tu comprends']);

function matchAt(tokens: string[], i: number): string[] | null {
  for (const p of DELIMITED) if (p.every((t, n) => tokens[i + n] === t)) return p;
  return null;
}

/** Indexes of words forming tics or stammered repeats. */
export function ticIndexes(words: Word[]): number[] {
  const tokens = words.map((w) => clean(w.text));
  const out = new Set<number>();
  for (let i = 0; i < words.length; i++) {
    if (out.has(i)) continue;
    if (/^(euh+|heu+|hum+|hmm+|mmh+)$/.test(tokens[i]!)) { out.add(i); continue; }   // pure hesitations are never words
    const p = matchAt(tokens, i);
    if (p) {
      let end = i + p.length - 1;
      const next = words[end + 1];
      const prev = words[i - 1];
      const lastText = words[end]!.text;
      const closesRight = hasPunct(lastText) || !next || isPunctOnly(next.text) || next.start - words[end]!.end > 0.25;
      const closesLeft = Boolean(prev) && (hasPunct(prev!.text) || isPunctOnly(prev!.text) || words[i]!.start - prev!.end > 0.25);
      const head = p[0]!;
      const nextToken = tokens[end + 1] ?? '';
      const prevToken = tokens[i - 1] ?? '';
      const keepByPrev = p.length === 1 && !closesLeft && KEEP_AFTER[head]?.test(prevToken);
      const keepByNext = p.length === 1 && !closesRight && KEEP_BEFORE[head]?.test(nextToken);
      // One-word tics need a pause on the right, or both sides, to be sure they mean nothing.
      const leftIsEnough = head === 'genre' || head === "'fin";
      const needsRight = p.length === 1 ? !leftIsEnough || !closesLeft : RIGHT_ONLY.has(p.join(' '));
      const delimited = needsRight ? closesRight : closesRight || closesLeft;
      if (delimited && !keepByPrev && !keepByNext) {
        if (next && isPunctOnly(next.text)) end += 1;
        for (let k = i; k <= end; k++) out.add(k);
        i = end;
        continue;
      }
    }
    // Stammers: "le, le", "je je", "tous les, tous les".
    for (const len of [3, 2, 1]) {
      const a = tokens.slice(i, i + len);
      const b = tokens.slice(i + len, i + 2 * len);
      if (b.length === len && a.every((t, n) => t && t === b[n]) && a.join('').length <= (len === 1 ? 5 : 24) && words[i + 2 * len - 1]!.start - words[i + len - 1]!.end < 1.2) {
        for (let k = i; k < i + len; k++) out.add(k);
        i += len - 1;
        break;
      }
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** Merges consecutive tic words into time ranges, reaching the neighbouring words so no fragment is left. */
export function ticCuts(words: Word[]): [number, number][] {
  const idx = ticIndexes(words);
  const out: [number, number][] = [];
  for (let n = 0; n < idx.length;) {
    let last = n;
    while (idx[last + 1] === idx[last]! + 1) last += 1;
    const first = idx[n]!;
    const end = idx[last]!;
    const before = words[first - 1];
    const after = words[end + 1];
    const a = before ? Math.max(before.end, words[first]!.start - 0.08) : words[first]!.start - 0.02;
    const b = after ? Math.min(after.start, words[end]!.end + 0.08) : words[end]!.end + 0.02;
    out.push([+Math.max(0, a).toFixed(3), +Math.max(a, b).toFixed(3)]);
    n = last + 1;
  }
  return out;
}

/** Words left once tics are gone: what the viewer will hear, and what the editor and the hook writer must read. */
export const withoutTics = (words: Word[]): Word[] => {
  const drop = new Set(ticIndexes(words));
  return words.filter((_, i) => !drop.has(i));
};

/** Whisper timings are approximate: move a cut boundary to the quietest instant nearby, so no syllable is clipped. */
export function snapToQuiet(db: Float32Array | number[], hop: number, t: number, radius = 0.08): number {
  const i0 = Math.max(0, Math.floor((t - radius) / hop));
  const i1 = Math.min(db.length - 1, Math.ceil((t + radius) / hop));
  let best = Math.min(db.length - 1, Math.max(0, Math.round(t / hop)));
  for (let i = i0; i <= i1; i++) if ((db[i] ?? 0) < (db[best] ?? 0)) best = i;
  return +(best * hop).toFixed(3);
}

export const countTics = (words: Word[]) => ticCuts(words).length;

/** Snaps a cut to the quiet, but only inside its own bounds: snapping outward clipped the short word next to a tic ("je", "ça"). */
export function snapInward(db: Float32Array | number[], hop: number, a: number, b: number, radius = 0.08): [number, number] {
  const quietest = (from: number, to: number, start: number) => {
    let best = start;
    for (let i = Math.max(0, from); i <= Math.min(db.length - 1, to); i++) if ((db[i] ?? 0) < (db[best] ?? 0)) best = i;
    return best;
  };
  const ia = Math.round(a / hop);
  const ib = Math.round(b / hop);
  const na = quietest(ia, Math.min(ib, ia + Math.round(radius / hop)), Math.min(ia, db.length - 1));
  const nb = quietest(Math.max(na, ib - Math.round(radius / hop)), ib, Math.min(ib, db.length - 1));
  return [Math.max(a, +(na * hop).toFixed(3)), Math.min(b, +(nb * hop).toFixed(3))];
}
