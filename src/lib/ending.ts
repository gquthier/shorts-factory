// Where a clip should really end, and whether it is worth anything. The model judges, these rules decide what can be done with it.
import { z } from 'zod';
import type { Sentence } from './transcript.ts';

export const EndingSchema = z.object({ end_sentence: z.number(), value: z.number(), takeaway: z.string(), why: z.string() });
export const MIN_VALUE = 3;
const LOOK_AHEAD = 75;

const plain = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Sentence numbers covering a time range. */
export function sentenceRange(sentences: Sentence[], start: number, end: number): { a: number; b: number } | null {
  const inside = sentences.map((s, i) => ({ s, i })).filter(({ s }) => (s.start + s.end) / 2 >= start - 0.5 && (s.start + s.end) / 2 <= end + 0.5);
  return inside.length ? { a: inside[0]!.i, b: inside.at(-1)!.i } : null;
}

/** The clip's sentences, then what he says right after: a conclusion often comes a little later. */
export function endingPrompt(sentences: Sentence[], a: number, b: number, title: string): string {
  const limit = sentences[b]!.end + LOOK_AHEAD;
  const line = (i: number) => `[${i}] ${sentences[i]!.text}`;
  const after: string[] = [];
  for (let i = b + 1; i < sentences.length && sentences[i]!.start <= limit; i++) after.push(line(i));
  const clip = Array.from({ length: b - a + 1 }, (_, n) => line(a + n));
  return `Sujet : ${title}\n\n<clip>\n${clip.join('\n')}\n</clip>\n\nCe qu'il dit juste après :\n<suite>\n${after.join('\n')}\n</suite>`;
}

/** Keeps the end the model chose while it stays in bounds: never before the clip's start, never over the maximum length. */
export function resolveEnd(sentences: Sentence[], a: number, b: number, chosen: number, maxSeconds: number): number {
  const limit = sentences[b]!.end + LOOK_AHEAD;
  let end = Number.isInteger(chosen) ? chosen : b;
  if (end <= a || end >= sentences.length || sentences[end]!.end > limit) end = b;
  while (end > b && sentences[end]!.end - sentences[a]!.start > maxSeconds) end -= 1;
  return end;
}

/** Finds an already edited clip back in the whole video from its first and last words. Its own times are relative to its section. */
export function alignToSource(sentences: Sentence[], transcript: string): { a: number; b: number } | null {
  const words = plain(transcript).split(' ').filter(Boolean);
  if (words.length < 6) return null;
  const tokens = sentences.map((s) => new Set(plain(s.text).split(' ').filter(Boolean)));
  const best = (probe: string[], from = 0) => {
    let top = { i: -1, score: 0 };
    tokens.forEach((t, i) => {
      if (i < from) return;
      // Sentences split differently between transcriptions, so each is scored with its neighbour.
      const merged = new Set([...t, ...(tokens[i + 1] ?? [])]);
      const score = probe.filter((w) => merged.has(w)).length / probe.length;
      if (score > top.score) top = { i, score };
    });
    return top;
  };
  const size = Math.min(10, Math.floor(words.length / 2));
  const first = best(words.slice(0, size));
  if (first.i < 0 || first.score < 0.6) return null;
  const last = best(words.slice(-size), first.i);
  if (last.i < 0 || last.score < 0.6) return null;
  const b = Math.min(sentences.length - 1, tokens[last.i + 1] && words.slice(-3).every((w) => tokens[last.i + 1]!.has(w)) ? last.i + 1 : last.i);
  return { a: first.i, b };
}
