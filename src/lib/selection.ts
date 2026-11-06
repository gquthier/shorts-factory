// Deterministic rules around the language model: it proposes, these decide. Pure, unit tested.

export interface Candidate { start: number; end: number; standalone: number }

/** Keeps the best clip of any pair overlapping by more than `maxOverlap` of the shorter one. */
export function dedupeClips<T extends Candidate>(clips: T[], maxOverlap = 0.5): T[] {
  const kept: T[] = [];
  for (const c of [...clips].sort((a, b) => b.standalone - a.standalone)) {
    const clash = kept.some((k) => {
      const overlap = Math.min(k.end, c.end) - Math.max(k.start, c.start);
      return overlap > maxOverlap * Math.min(k.end - k.start, c.end - c.start);
    });
    if (!clash) kept.push(c);
  }
  return kept.sort((a, b) => a.start - b.start);
}

const BANNED = /\b(découvrez|découvre|voici comment|le secret|tu ne vas pas croire|incroyable|dans cette vidéo|à ne pas manquer|révolutionn)/i;
const EMOJI = /\p{Extended_Pictographic}/u;
const NUMBER_WORDS: Record<string, string> = { un: '1', une: '1', deux: '2', trois: '3', quatre: '4', cinq: '5', six: '6', sept: '7', huit: '8', neuf: '9', dix: '10', onze: '11', douze: '12', quinze: '15', vingt: '20', trente: '30', cinquante: '50', cent: '100', mille: '1000' };
const digitsOnly = (s: string) => s.replace(/\b(deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|quinze|vingt|trente|cinquante|cent|mille)\b/gi, (m) => NUMBER_WORDS[m.toLowerCase()]!);
export const numbersIn = (s: string) => (digitsOnly(s).replace(/(\d)[\s.  ](?=\d{3}\b)/g, '$1').match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(',', '.'));

/** Returns the reason a hook is unusable, or null. A figure the speaker never said is a hard failure. */
export function hookProblem(hook: string, transcript: string): string | null {
  const words = hook.trim().split(/\s+/).filter((w) => /[\p{L}\d]/u.test(w));
  if (words.length < 3) return 'too short';
  if (words.length > 13) return 'too long';
  if (BANNED.test(hook)) return 'banned phrase';
  if (EMOJI.test(hook)) return 'emoji';
  if (/!/.test(hook)) return 'exclamation mark';
  if (hook === hook.toUpperCase()) return 'all caps';
  const said = new Set(numbersIn(transcript));
  const invented = numbersIn(hook).filter((n) => !said.has(n));
  return invented.length ? `figure not in the clip: ${invented.join(', ')}` : null;
}

/** Round-robin through the mix for this kind, skipping templates that do not exist yet. */
export function pickTemplate(mix: string[] | undefined, available: string[], index: number): string {
  const usable = (mix ?? []).filter((t) => available.includes(t));
  const pool = usable.length ? usable : available;
  if (!pool.length) throw new Error('No template available');
  return pool[index % pool.length]!;
}

export interface Slot { account: string; maxPerDay: number }

/** Spreads approved clips over accounts without exceeding each one's daily cap. The rest waits. */
export function assignToAccounts<T extends { id: string }>(clips: T[], accounts: Slot[]): { assigned: (T & { account: string })[]; backlog: T[] } {
  const queue = accounts.flatMap((a) => Array.from({ length: a.maxPerDay }, (_, round) => ({ account: a.account, round })))
    .sort((x, y) => x.round - y.round);
  return {
    assigned: clips.slice(0, queue.length).map((c, i) => ({ ...c, account: queue[i]!.account })),
    backlog: clips.slice(queue.length),
  };
}

const CAPTION_BANNED = /\b(voil[aà] comment|voici|je te montre|d[ée]couvr|[çc]a change tout|la cl[ée]|le secret|dans un monde|n'h[ée]site|booster|game.?changer|lib[èe]re ton|abonne-toi|lien en bio|commente)/i;

/** Returns the reason a description is unusable, or null. Short, in his voice, and it never invents a figure. */
export function captionProblem(caption: string, transcript: string, hook: string): string | null {
  const text = caption.trim();
  if (text.length > 120) return 'too long';
  if (text.length < 8 || text.split(/\s+/).filter((w) => /[\p{L}\d]/u.test(w)).length < 4) return 'too short';
  if (text.split('\n').filter(Boolean).length > 2) return 'too many lines';
  if (/[—–]/.test(text)) return 'dash';
  if (/#\p{L}/u.test(text)) return 'hashtag';
  if (/https?:|www\./i.test(text)) return 'link';
  if ((text.match(/!/g) ?? []).length > 1) return 'exclamation marks';
  if ((text.match(/\p{Extended_Pictographic}/gu) ?? []).length > 1) return 'emojis';
  if (CAPTION_BANNED.test(text)) return 'banned phrase';
  const plain = (s: string) => s.toLowerCase().replace(/\*/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (plain(text) === plain(hook)) return 'same as the hook';
  const said = new Set(numbersIn(transcript));
  const invented = numbersIn(text).filter((n) => !said.has(n));
  return invented.length ? `figure not in the clip: ${invented.join(', ')}` : null;
}
