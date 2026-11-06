// Word-level transcript utilities. Pure functions: no I/O, fully unit tested.
export interface Word { text: string; start: number; end: number }
/** boundary: how the sentence begins. 'full' after a full stop or a pause, 'comma' after a comma, 'cut' at an arbitrary word. */
export interface Sentence { i: number; text: string; start: number; end: number; w0: number; w1: number; boundary: 'full' | 'comma' | 'cut'; ends: boolean }

interface WhisperToken { text?: string; offsets: { from: number; to: number } }
interface WhisperJson { transcription?: { tokens?: WhisperToken[] }[] }

const NOISE = /^\[.*\]$/;

export function wordsFromWhisper(json: WhisperJson): Word[] {
  // Local arrays are built with push: a live transcript holds 30k+ words, spreads would be quadratic.
  const merged: Word[] = [];
  for (const seg of json.transcription ?? []) {
    for (const t of seg.tokens ?? []) {
      const text = t.text ?? '';
      if (!text.trim() || NOISE.test(text.trim())) continue;
      const from = t.offsets.from / 1000;
      const to = t.offsets.to / 1000;
      const last = merged.at(-1);
      if (last && !/^\s/.test(text)) {
        merged[merged.length - 1] = { ...last, text: last.text + text, end: Math.max(last.end, to) };
      } else {
        merged.push({ text: text.trim(), start: from, end: Math.max(to, from + 0.02) });
      }
    }
  }
  const out: Word[] = [];
  for (const w of merged) {
    const prev = out.at(-1);
    if (!w.text) continue;
    out.push({ ...w, start: prev && w.start < prev.end ? Math.min(prev.end, w.end - 0.02) : w.start });
  }
  return out;
}

const ENDS_SENTENCE = /[.!?…]["»)]?$/;

export function sentencesFromWords(words: Word[], { maxWords = 32, softWords = 14, maxGap = 0.7 } = {}): Sentence[] {
  // Spoken French often runs for minutes with commas and no full stop, so long runs break at commas first.
  const out: Sentence[] = [];
  let w0 = 0;
  let boundary: Sentence['boundary'] = 'full';
  words.forEach((w, i) => {
    const next = words[i + 1];
    const gap = next ? next.start - w.end : Infinity;
    const full = ENDS_SENTENCE.test(w.text) || gap > maxGap;
    const count = i - w0 + 1;
    const comma = /[,;:]$/.test(w.text) && count >= softWords;
    if (!full && !comma && count < maxWords) return;
    const slice = words.slice(w0, i + 1);
    out.push({ i: out.length, text: slice.map((x) => x.text).join(' '), start: slice[0]!.start, end: w.end, w0, w1: i, boundary, ends: closes(words, i) });
    boundary = full ? 'full' : comma ? 'comma' : 'cut';
    w0 = i + 1;
  });
  return out;
}

/** A clip may close here: a real full stop, or a long pause after a word with no trailing comma or question. */
function closes(words: Word[], i: number): boolean {
  const w = words[i]!;
  const gap = words[i + 1] ? words[i + 1]!.start - w.end : Infinity;
  if (/[?,;:]["»)]?$/.test(w.text)) return false;   // a question opens a loop: the answer comes next
  return /[.!…]["»)]?$/.test(w.text) || gap > 1.2;
}

const WEAK_START = /^(de|du|des|d'|à|au|aux|qui|que|qu'|pour|sur|avec|en|et|ou|par|dans|ni|dont|où|comme|si|parce)\b/i;

/** Can a clip open on this sentence? Never at an arbitrary word, never on a word that needs what came before. */
export const canOpenClip = (s: Sentence) => s.boundary !== 'cut' && !WEAK_START.test(s.text);

/**
 * Tightens a proposed range to the nearest usable opening and closing sentences.
 * Returns null when what remains is too short: better no clip than one that opens mid-phrase.
 */
export function snapRange(sentences: Sentence[], a: number, b: number, minDur: number): { a: number; b: number } | null {
  let start = a;
  while (start <= b && !canOpenClip(sentences[start]!)) start += 1;
  let end = b;
  while (end > start && !sentences[end]!.ends) end -= 1;
  if (start > b || end <= start) return null;
  return sentences[end]!.end - sentences[start]!.start >= minDur ? { a: start, b: end } : null;
}

const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
};

export const transcriptForLlm = (sentences: Sentence[]) =>
  sentences.map((s) => `[${s.i}|${fmt(s.start)}${canOpenClip(s) ? '' : '|suite'}] ${s.text}`).join('\n');

/** Slice words to source ranges and remap them onto the assembled take's timeline. */
export function remapWords(words: Word[], ranges: [number, number][]): Word[] {
  let offset = 0;
  const out: Word[] = [];
  for (const [a, b] of ranges) {
    for (const w of words) {
      const mid = (w.start + w.end) / 2;
      if (mid >= a && mid <= b) {
        out.push({ text: w.text, start: Math.max(0, w.start - a + offset), end: w.end - a + offset });
      }
    }
    offset += b - a;
  }
  return out;
}


/** French typography: a line must never start with ":", "?", "!", ";" or "%". */
export const frenchSpacing = (s: string) => s.replace(/\s+([:;?!%»€])/g, '\u00A0$1').replace(/«\s+/g, '«\u00A0');

/** Clip bounds with a little air, but never reaching into the neighbouring sentences' words. */
export function tightRange(words: Word[], start: number, end: number, pad = { before: 0.1, after: 0.28 }): [number, number] {
  const prev = words.filter((w) => w.end <= start + 0.01).at(-1);
  const next = words.find((w) => w.start >= end - 0.01);
  const a = Math.max(0, start - pad.before, prev ? prev.end + 0.01 : 0);
  const b = next ? Math.min(end + pad.after, Math.max(end, next.start - 0.01)) : end + pad.after;
  return [Math.min(a, start), Math.max(b, end)];
}

/** Long pauses that word timings hide, as take ranges to drop, keeping a short breath at each side. */
export function silenceCuts(silences: { start: number; end: number }[], minLength = 0.45, keep = 0.12): [number, number][] {
  return silences.filter((s) => s.end - s.start >= minLength).map((s): [number, number] => [+(s.start + keep).toFixed(3), +(s.end - keep).toFixed(3)]);
}

export function parseSilences(ffmpegLog: string): { start: number; end: number }[] {
  const starts = [...ffmpegLog.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...ffmpegLog.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  return starts.flatMap((start, i) => (ends[i] === undefined ? [] : [{ start, end: ends[i]! }]));
}

const plain = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Start time of the first occurrence of a phrase in the words, or null. Used to land a visual on the word that says it. */
/** Where a phrase is said, as word indexes. */
function phraseIndexes(words: Word[], phrase: string, from = 0): { first: number; last: number } | null {
  const target = plain(phrase).split(' ').filter(Boolean);
  if (!target.length) return null;
  const tokens = words.map((w) => plain(w.text));
  for (let i = 0; i < tokens.length; i++) {
    if (words[i]!.start < from) continue;
    let j = 0;
    let k = i;
    while (j < target.length && k < tokens.length) {
      const parts = tokens[k]!.split(' ').filter(Boolean);
      if (!parts.length) { k += 1; continue; }
      if (parts.some((p, n) => p !== target[j + n])) break;
      j += parts.length;
      k += 1;
    }
    if (j >= target.length) return { first: i, last: k - 1 };
  }
  return null;
}

export function findPhrase(words: Word[], phrase: string, from = 0): number | null {
  const at = phraseIndexes(words, phrase, from);
  return at ? words[at.first]!.start : null;
}

/** The stretch to replay at the opening, or null when the line is not worth it or would sound wrong on its own. */
export function coldOpenRange(words: Word[], phrase: string, clip: [number, number], cuts: [number, number][]): [number, number] | null {
  const inside = words.filter((w) => w.start >= clip[0] - 0.01 && w.end <= clip[1] + 0.01);
  const at = phraseIndexes(inside, phrase);
  if (!at) return null;
  const start = inside[at.first]!.start;
  const end = inside[at.last]!.end;
  if (end - start < 2 || end - start > 7) return null;
  if (start < clip[0] + 5) return null;                         // already at the top of the clip: repeating it adds nothing
  if (cuts.some(([a, b]) => a < end && b > start)) return null; // the edit removed part of it
  const next = inside[at.last + 1];
  const prev = inside[at.first - 1];
  return [Math.max(start - 0.05, prev ? prev.end : 0), next ? Math.min(end + 0.18, next.start) : end + 0.18];
}
