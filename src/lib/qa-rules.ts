// Pure checks behind the QA stage: given what was heard and what was read in the final video, what is wrong?

export interface Timed { text: string; start: number; end: number }
export interface Box { x: number; y: number; w: number; h: number }
export interface Frame { t: number; texts: (Box & { text: string; conf: number })[]; face?: Box; mouth?: Box; eyes?: Box[] }
export type Severity = 'fail' | 'warn';
export interface Finding { severity: Severity; code: string; message: string }

export const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const tokens = (ws: Timed[]) => ws.flatMap((w) => norm(w.text).split(' ').filter(Boolean).map((t) => ({ t, start: w.start })));

/** Longest common subsequence, as index pairs. Fine at clip scale: a few hundred words. */
function lcs(a: string[], b: string[]): [number, number][] {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const pairs: [number, number][] = [];
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) { pairs.push([i, j]); i += 1; j += 1; } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i += 1; else j += 1;
  }
  return pairs;
}

export interface AudioReport { recall: number; firstOk: boolean; lastOk: boolean; syncMedian: number; syncP90: number; matched: number; expected: number }

/** Compares the captions' words against a fresh transcription of the final audio. */
export function compareAudio(captions: Timed[], heard: Timed[]): AudioReport {
  const c = tokens(captions);
  const h = tokens(heard);
  const pairs = lcs(c.map((x) => x.t), h.map((x) => x.t));
  const diffs = pairs.map(([i, j]) => Math.abs(c[i]!.start - h[j]!.start)).sort((x, y) => x - y);
  const edge = 4;
  const matchedC = new Set(pairs.map(([i]) => i));
  const firstOk = [...Array(Math.min(edge, c.length)).keys()].filter((i) => matchedC.has(i)).length >= Math.min(2, c.length);
  const lastOk = [...Array(Math.min(edge, c.length)).keys()].map((i) => c.length - 1 - i).filter((i) => matchedC.has(i)).length >= Math.min(2, c.length);
  return {
    recall: c.length ? pairs.length / c.length : 0,
    firstOk, lastOk,
    syncMedian: diffs[diffs.length >> 1] ?? 0,
    syncP90: diffs[Math.floor(diffs.length * 0.9)] ?? 0,
    matched: pairs.length,
    expected: c.length,
  };
}

export const SAFE = { top: 220, bottomY: 1500, rightX: 940, rightFromY: 900, rightToY: 1700, side: 24 };

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Boxes that belong to the footage itself (a shared screen) are not our text and are ignored. */
export function checkFrames(frames: Frame[], o: { contentRect?: Box; captions: Timed[]; speed?: number }): { findings: Finding[]; readableShare: number; mouthCovered: number; unsafe: number } {
  const ours = (b: Box) => !o.contentRect || !overlaps(b, { ...o.contentRect, y: o.contentRect.y + 4, h: o.contentRect.h - 8 }) || (b.y + b.h / 2 > o.contentRect.y + o.contentRect.h);
  let unsafe = 0;
  let mouthCovered = 0;
  let spoken = 0;
  let readable = 0;
  const examples = new Set<string>();
  for (const f of frames) {
    const texts = f.texts.filter((b) => b.conf >= 0.3 && ours(b));
    for (const b of texts) {
      const inRightRail = b.x + b.w > SAFE.rightX && b.y + b.h > SAFE.rightFromY && b.y < SAFE.rightToY;
      if (b.y < SAFE.top || b.y + b.h > SAFE.bottomY || inRightRail || b.x < SAFE.side || b.x + b.w > 1080 - SAFE.side) {
        unsafe += 1;
        if (examples.size < 3) examples.add(`"${b.text.slice(0, 30)}" à y=${Math.round(b.y)}`);
      }
    }
    if (f.mouth && !o.contentRect && texts.some((b) => overlaps(b, f.mouth!))) mouthCovered += 1;
    const said = o.captions.filter((w) => f.t >= w.start - 0.05 && f.t <= w.end + 0.6);
    if (said.length) {
      spoken += 1;
      // Any text counts here: captions may sit over a shared screen. A word matching by chance on footage is rare.
      const read = norm(f.texts.filter((b) => b.conf >= 0.3).map((b) => b.text).join(' '));
      if (said.some((w) => norm(w.text).split(' ').some((p) => p.length > 1 && read.includes(p)))) readable += 1;
    }
  }
  const readableShare = spoken ? readable / spoken : 1;
  const findings: Finding[] = [];
  if (unsafe) findings.push({ severity: 'warn', code: 'safe-zone', message: `Texte hors zone sûre sur ${unsafe} détection(s) : ${[...examples].join(', ')}` });
  if (mouthCovered / Math.max(1, frames.length) > 0.1) findings.push({ severity: 'warn', code: 'mouth', message: `Sous-titres sur la bouche sur ${mouthCovered} image(s) sur ${frames.length}` });
  if (readableShare < 0.5) findings.push({ severity: 'fail', code: 'captions-unreadable', message: `Sous-titres lus sur seulement ${Math.round(readableShare * 100)} % des images parlées` });
  else if (readableShare < 0.7) findings.push({ severity: 'warn', code: 'captions-weak', message: `Sous-titres lus sur ${Math.round(readableShare * 100)} % des images parlées` });
  return { findings, readableShare, mouthCovered, unsafe };
}

export function judgeAudio(a: AudioReport): Finding[] {
  const f: Finding[] = [];
  if (a.recall < 0.7) f.push({ severity: 'fail', code: 'words-lost', message: `Seuls ${Math.round(a.recall * 100)} % des mots sous-titrés sont réentendus dans le son final` });
  else if (a.recall < 0.85) f.push({ severity: 'warn', code: 'words-low', message: `${Math.round(a.recall * 100)} % des mots sous-titrés réentendus` });
  if (!a.firstOk) f.push({ severity: 'warn', code: 'start-clipped', message: 'Les premiers mots ne sont pas réentendus : début peut-être coupé' });
  if (!a.lastOk) f.push({ severity: 'warn', code: 'end-clipped', message: 'Les derniers mots ne sont pas réentendus : fin peut-être coupée' });
  if (a.syncMedian > 0.35) f.push({ severity: 'fail', code: 'desync', message: `Sous-titres décalés de ${a.syncMedian.toFixed(2)} s en médiane` });
  else if (a.syncMedian > 0.18) f.push({ severity: 'warn', code: 'desync-light', message: `Décalage des sous-titres de ${a.syncMedian.toFixed(2)} s en médiane` });
  return f;
}

export function judgeTech(t: { width: number; height: number; codec: string; duration: number; lufs: number | null; truePeak: number | null; longestSilence: number; blackSeconds: number }): Finding[] {
  const f: Finding[] = [];
  if (t.width !== 1080 || t.height !== 1920) f.push({ severity: 'fail', code: 'size', message: `Format ${t.width}×${t.height} au lieu de 1080×1920` });
  if (t.codec !== 'h264') f.push({ severity: 'fail', code: 'codec', message: `Codec ${t.codec}` });
  if (t.duration < 8 || t.duration > 90) f.push({ severity: 'warn', code: 'duration', message: `Durée ${t.duration.toFixed(1)} s` });
  if (t.lufs !== null && (t.lufs < -17 || t.lufs > -12)) f.push({ severity: 'warn', code: 'loudness', message: `Volume ${t.lufs} LUFS` });
  if (t.truePeak !== null && t.truePeak > -0.8) f.push({ severity: 'warn', code: 'peak', message: `Crête ${t.truePeak} dBTP` });
  if (t.longestSilence > 1.2) f.push({ severity: 'warn', code: 'silence', message: `Blanc de ${t.longestSilence.toFixed(1)} s` });
  if (t.blackSeconds > 0.3) f.push({ severity: 'fail', code: 'black', message: `${t.blackSeconds.toFixed(1)} s d'image noire dans la vidéo` });
  return f;
}

export function judgeTics(count: number, seconds: number): Finding[] {
  const f: Finding[] = [];
  if (count >= 3 || count / Math.max(1, seconds) > 0.08) f.push({ severity: 'warn', code: 'tics', message: `${count} tics de langage encore entendus` });
  if (seconds > 55) f.push({ severity: 'warn', code: 'long', message: `Clip long : ${Math.round(seconds)} s` });
  return f;
}

export const qaStatus = (findings: Finding[]): 'pass' | 'warn' | 'fail' =>
  findings.some((f) => f.severity === 'fail') ? 'fail' : findings.length ? 'warn' : 'pass';
