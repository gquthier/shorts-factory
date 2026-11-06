// Rules around the language model when it shortens a clip: it proposes what to drop, these keep the result sound. Pure, unit tested.
import { canOpenClip, type Word } from './transcript.ts';

export interface Clause { i: number; text: string; start: number; end: number; w0: number; w1: number }

/** Clauses split on punctuation, the smallest unit that can be removed and still read correctly. */
export function clausesFromWords(words: Word[], maxWords = 22): Clause[] {
  const out: Clause[] = [];
  let w0 = 0;
  words.forEach((w, i) => {
    const count = i - w0 + 1;
    if (!/[,;:.!?…]["»)]?$/.test(w.text) && i < words.length - 1 && count < maxWords) return;
    const slice = words.slice(w0, i + 1);
    out.push({ i: out.length, text: slice.map((x) => x.text).join(' '), start: slice[0]!.start, end: w.end, w0, w1: i });
    w0 = i + 1;
  });
  return out;
}

const plain = (s: string) => s.toLowerCase().replace(/’/g, "'").normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}']+/gu, ' ').trim();

/** The moment was found on approximate timings: find its true first and last word in the precise transcript by matching the text. */
export function alignBounds(words: Word[], text: string, fallback: { start: number; end: number }): Word[] {
  const tokens = plain(text).split(' ').filter(Boolean);
  const hay = words.map((w) => plain(w.text).replace(/ /g, ''));
  const find = (needle: string[], fromEnd: boolean): number => {
    const idx = [...hay.keys()];
    for (const i of fromEnd ? idx.reverse() : idx) {
      if (needle.every((t, n) => hay[i + n] === t)) return fromEnd ? i + needle.length - 1 : i;
    }
    return -1;
  };
  const search = (slice: (n: number) => string[], fromEnd: boolean) => {
    for (const n of [4, 3, 2]) { const hit = find(slice(n), fromEnd); if (hit >= 0) return hit; }
    return -1;
  };
  const a = search((n) => tokens.slice(0, n), false);
  const b = search((n) => tokens.slice(-n), true);
  const byTime = (w: Word) => (w.start + w.end) / 2 >= fallback.start && (w.start + w.end) / 2 <= fallback.end;
  if (a < 0 || b < 0 || b <= a) return words.filter(byTime);
  return words.slice(a, b + 1);
}

const FULL_STOP = /[.!…]["»)]?$/;
const ANY_STOP = /[.!?…]["»)]?$/;

/**
 * Precise punctuation lets a clip start and end on real sentences: moves the opening forward to the next sentence start,
 * and the ending back to the last finished sentence, or forward to the next one when going back would leave too little.
 */
export function snapToSentences(all: Word[], bounded: Word[], minSeconds: number): Word[] {
  if (!bounded.length) return bounded;
  let a = all.indexOf(bounded[0]!);
  let b = all.indexOf(bounded.at(-1)!);
  if (a < 0 || b < 0) return bounded;
  const length = (x: number, y: number) => all[y]!.end - all[x]!.start;
  const maxSkip = bounded.at(-1)!.end - bounded[0]!.start;
  if (a > 0 && !ANY_STOP.test(all[a - 1]!.text)) {
    for (let i = a + 1; i < b; i++) {
      if (all[i]!.start - all[a]!.start > maxSkip * 0.35) break;
      if (ANY_STOP.test(all[i - 1]!.text) && length(i, b) >= minSeconds) { a = i; break; }
    }
  }
  if (!FULL_STOP.test(all[b]!.text)) {
    let back = -1;
    for (let i = b - 1; i > a; i--) if (FULL_STOP.test(all[i]!.text)) { back = i; break; }
    let forward = -1;
    for (let i = b + 1; i < all.length; i++) if (FULL_STOP.test(all[i]!.text)) { forward = i; break; }
    if (back >= 0 && length(a, back) >= minSeconds) b = back;
    else if (forward >= 0) b = forward;
  }
  return all.slice(a, b + 1);
}

const CONNECTOR = /^(donc|mais|et|alors|bref|puis|ou|car|sinon|ensuite|aussi)[,:]?$/i;

/** A clip should open on the idea: drops leading connectors ("Donc,", "Mais") and stray one or two-word fragments ("mastermind,"). */
export function trimOpening(words: Word[]): Word[] {
  let i = 0;
  for (let guard = 0; guard < 8 && i < words.length - 3; guard++) {
    if (CONNECTOR.test(words[i]!.text)) { i += 1; continue; }
    const fragment = [1, 2].find((n) => /,$/.test(words[i + n - 1]!.text) && !words.slice(i, i + n - 1).some((w) => /[,.!?]$/.test(w.text)));
    if (fragment) { i += fragment; continue; }
    break;
  }
  return words.slice(i);
}

const speech = (clauses: Clause[]) => clauses.reduce((sum, c) => sum + (c.end - c.start), 0);
const opens = (c: Clause) => canOpenClip({ i: c.i, text: c.text, start: c.start, end: c.end, w0: c.w0, w1: c.w1, boundary: 'full', ends: false });
const closes = (c: Clause) => /[.!…]["»)]?$/.test(c.text);

export interface ShortenResult { kept: Clause[]; dropped: Clause[]; seconds: number; applied: boolean; reason?: string }

/**
 * Applies the proposal only if the result still opens and closes properly and stays long enough.
 * A rejected proposal changes nothing: a long clip is better than a broken one.
 */
export function applyShortening(clauses: Clause[], remove: number[], o: { minSeconds: number; maxRemovedShare?: number }): ShortenResult {
  const drop = new Set(remove.filter((n) => Number.isInteger(n) && n >= 0 && n < clauses.length));
  const refuse = (reason: string): ShortenResult => ({ kept: clauses, dropped: [], seconds: speech(clauses), applied: false, reason });
  if (!drop.size) return refuse('rien à couper');
  // Trim what the proposal leaves at the edges until the clip opens and closes on usable clauses.
  let kept = clauses.filter((c) => !drop.has(c.i));
  while (kept.length && !opens(kept[0]!)) kept = kept.slice(1);
  while (kept.length && !closes(kept.at(-1)!)) kept = kept.slice(0, -1);
  if (kept.length < 2) return refuse('ouverture ou fin inutilisable');
  const seconds = speech(kept);
  if (seconds < o.minSeconds) return refuse(`trop court : ${Math.round(seconds)} s`);
  if (1 - seconds / speech(clauses) > (o.maxRemovedShare ?? 0.6)) return refuse('trop coupé');
  const keptSet = new Set(kept.map((c) => c.i));
  return { kept, dropped: clauses.filter((c) => !keptSet.has(c.i)), seconds, applied: true };
}

/** Time ranges to remove so that only the kept clauses remain, between the first and last of them. */
export function cutsBetween(kept: Clause[], words: Word[]): [number, number][] {
  const out: [number, number][] = [];
  for (let n = 0; n < kept.length - 1; n++) {
    const a = kept[n]!;
    const b = kept[n + 1]!;
    if (b.w0 === a.w1 + 1) continue;
    out.push([+words[a.w1]!.end.toFixed(3), +words[b.w0]!.start.toFixed(3)]);
  }
  return out;
}
