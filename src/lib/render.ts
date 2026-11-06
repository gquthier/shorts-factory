import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ENGINE, WHISPER_MODEL } from './config.ts';
import { probeFaces, type FaceInfo } from './face.ts';
import { log } from './log.ts';
import { renderOverlays } from './overlay.ts';
import { isFullCamera } from './framing.ts';
import { cropExpr, planShots, verticalFrame } from './reframe.ts';
import { sampleFrames } from './vision.ts';
import { probeDuration, probeSize, run } from './sh.ts';
import { loadTemplate, type TemplateCtx } from './templates.ts';
import { snapInward, ticCuts } from './tics.ts';
import { findPhrase, frenchSpacing, parseSilences, remapWords, silenceCuts, type Word } from './transcript.ts';

export interface RenderJob {
  id: string;
  template: string;
  sourcePath: string;
  sourceWords: Word[];
  ranges: [number, number][];           // source ranges, in play order (allows a cold open)
  hook: string;
  question?: string;
  emph?: string[];
  replace?: [string, string][];
  extraCuts?: [number, number][];
  beats?: { phrase: string; text: string; kind: 'stat' | 'label' | 'tool' }[];
  broll?: { path: string; tags: string[] }[];
  creator: { name: string; lang: string };
  outDir: string;
  fresh?: boolean;
}

const SCREEN_TEMPLATE = 'black-frame';
const CAMERA_TEMPLATE = 'cinema-talk';
/** Screen shares and webcam-in-a-corner layouts: the speaker's face is a small part of the frame, or absent. */
export const isScreenShare = (f: Pick<FaceInfo, 'faceH' | 'h' | 'detected'>) => !f.detected || f.faceH / f.h < 0.2;

const engine = (args: string[]) => run('node', [path.join(ENGINE, 'short.mjs'), ...args], { env: { ...process.env, WHISPER_MODEL } });

/** Cuts the raw take from the source, in play order. */
async function cutRaw(job: RenderJob, raw: string): Promise<void> {
  const encode = ['-c:v', 'libx264', '-crf', '15', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000'];
  if (job.ranges.length === 1) {
    const [a, b] = job.ranges[0]!;
    await run('ffmpeg', ['-v', 'error', '-y', '-ss', String(a), '-i', job.sourcePath, '-t', String(b - a), ...encode, raw]);
    return;
  }
  const inputs = job.ranges.flatMap(([a, b]) => ['-ss', String(a), '-t', String(b - a), '-i', job.sourcePath]);
  const labels = job.ranges.map((_, i) => `[${i}:v][${i}:a]`).join('');
  await run('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', `${labels}concat=n=${job.ranges.length}:v=1:a=1[v][a]`, '-map', '[v]', '-map', '[a]', ...encode, raw]);
}

/** Face-following 9:16 crop: holds still, re-centres on a hard cut when the speaker moves. */
async function cropVertical(raw: string, file: string, face: FaceInfo): Promise<void> {
  const frame = verticalFrame(face);
  const shots = planShots(face.samples, { cropW: frame.w, srcW: face.w, dur: await probeDuration(raw) });
  const zoomed = frame.h < face.h ? ',scale=1080:1920:flags=lanczos,unsharp=5:5:0.4' : '';
  await run('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-vf', `crop=${frame.w}:${frame.h}:'${cropExpr(shots)}':${frame.y}${zoomed}`, '-c:v', 'libx264', '-crf', '15', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'copy', file]);
}

function punchInTimes(words: Word[], gap = 3.5): number[] {
  const out: number[] = [];
  words.forEach((w, i) => {
    const prev = words[i - 1];
    const boundary = !prev || /[.!?…,;:]$/.test(prev.text) || w.start - prev.end > 0.25;
    if (boundary && w.start - (out.at(-1) ?? -gap) >= gap) out.push(+w.start.toFixed(3));
  });
  return out;
}

const scribe = (ws: Word[], lang: string) => ({
  language_code: lang,
  text: ws.map((w) => w.text).join(' '),
  words: ws.flatMap((w, i) => {
    const word = { text: w.text, start: +w.start.toFixed(3), end: +w.end.toFixed(3), type: 'word' };
    return i ? [{ text: ' ', start: +ws[i - 1]!.end.toFixed(3), end: word.start, type: 'spacing' }, word] : [word];
  }),
  source: 'whisper.cpp',
});

/** The engine's spec keeps all look decisions; overlays add real typography on top. */
async function composite(video: string, overlays: { png: string; from?: number; to?: number }[], out: string): Promise<void> {
  if (!overlays.length) { fs.copyFileSync(video, out); return; }
  const inputs = overlays.flatMap((o) => ['-i', o.png]);
  let last = '0:v';
  const graph = overlays.map((o, i) => {
    const enable = o.from != null || o.to != null ? `:enable='between(t,${o.from ?? 0},${o.to ?? 99999})'` : '';
    const label = `v${i}`;
    const f = `[${last}][${i + 1}:v]overlay=0:0${enable}[${label}]`;
    last = label;
    return f;
  }).join(';');
  await run('ffmpeg', ['-v', 'error', '-y', '-i', video, ...inputs, '-filter_complex', graph, '-map', `[${last}]`, '-map', '0:a',
    '-c:v', 'h264_videotoolbox', '-b:v', '9M', '-maxrate', '12M', '-bufsize', '18M', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', out]);
}

/** Audio loudness in 10 ms steps, to place cuts in the quiet between words rather than on approximate word timings. */
async function loudness(file: string): Promise<{ db: Float32Array; hop: number }> {
  const raw = await new Promise<Buffer>((resolve, reject) => {
    execFile('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '1', '-ar', '16000', '-'], { encoding: 'buffer', maxBuffer: 1 << 30 }, (e, out) => (e ? reject(e) : resolve(out)));
  });
  const x = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 4));
  const hop = 160;
  const db = new Float32Array(Math.floor(x.length / hop));
  for (let f = 0; f < db.length; f++) {
    let e = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) e += x[i]! * x[i]!;
    db[f] = 10 * Math.log10(e / hop + 1e-12);
  }
  return { db, hop: hop / 16000 };
}

/** Verbal tics, long silences and editorial cuts, all merged. Tic boundaries are snapped to silence so no syllable is clipped. */
async function allCuts(take: string, words: Word[], extra: [number, number][]): Promise<[number, number][]> {
  const { db, hop } = await loudness(take);
  const snapped = [...ticCuts(words), ...extra].map(([a, b]) => snapInward(db, hop, a, b)).filter(([a, b]) => b > a);
  const silences = silenceCuts(parseSilences((await run('ffmpeg', ['-hide_banner', '-i', take, '-af', 'silencedetect=noise=-38dB:d=0.45', '-vn', '-f', 'null', '-'])).stderr));
  return [...snapped, ...silences].sort((x, y) => x[0] - y[0]);
}

export interface RenderResult { screenShare: boolean; template: string; output: string; poster: string; duration: number; seconds: number; qc: string }

export async function renderClip(job: RenderJob): Promise<RenderResult> {
  const t0 = Date.now();
  const ctxLog = { name: 'render.clip', clipId: job.id, template: job.template };
  fs.mkdirSync(job.outDir, { recursive: true });
  const raw = path.join(job.outDir, 'raw.mp4');
  await cutRaw(job, raw);
  const rawFace = await probeFaces(raw);
  const portrait = rawFace.h > rawFace.w;
  // On camera, sitting back in OBS: the face is small but he fills the frame. Vertical and close beats a horizontal band.
  const screenShare = isScreenShare(rawFace) && !isFullCamera(await sampleFrames(raw), 960, Math.round((960 * rawFace.h) / rawFace.w));
  const requested = await loadTemplate(job.template);
  const chosen = screenShare ? (requested.meta.screenShare ? job.template : SCREEN_TEMPLATE) : job.template === SCREEN_TEMPLATE ? CAMERA_TEMPLATE : job.template;
  const template = chosen === job.template ? requested : await loadTemplate(chosen);
  const project = path.join(job.outDir, 'project');
  if (job.fresh) fs.rmSync(project, { recursive: true, force: true });
  const take = path.join(job.outDir, 'take.mp4');
  const vertical = template.meta.vertical && template.meta.cropForVertical !== false && rawFace.w / rawFace.h > 9 / 16 + 0.02;
  if (vertical) { await cropVertical(raw, take, rawFace); fs.rmSync(raw); } else fs.renameSync(raw, take);
  if (!fs.existsSync(path.join(project, 'source/spec.js'))) await engine(['init', project, '--source', take]);

  const words = remapWords(job.sourceWords, job.ranges);
  if (!words.length) throw new Error(`No words in clip ${job.id}: ranges do not match the transcript`);
  fs.writeFileSync(path.join(project, 'assets/words-scribe.json'), JSON.stringify(scribe(words, job.creator.lang)));

  const { w, h } = await probeSize(take);
  const face: FaceInfo = vertical ? await probeFaces(take, 1) : rawFace;
  const ctx: TemplateCtx = {
    hook: frenchSpacing(job.hook),
    question: job.question ? frenchSpacing(job.question) : undefined,
    words,
    duration: await probeDuration(take),
    emph: job.emph ?? [],
    replace: job.replace ?? [],
    cut: await allCuts(take, words, job.extraCuts ?? []),
    face,
    screenShare,
    take: { w, h },
    broll: job.broll ?? [],
    creator: job.creator,
    punchIns: punchInTimes(words),
    beats: (job.beats ?? []).flatMap((b) => { const t = findPhrase(words, b.phrase); return t === null ? [] : [{ t, text: b.text, kind: b.kind }]; }).sort((a, b) => a.t - b.t),
  };
  // Library sounds and pre-rendered pictures the spec points to, inside the project.
  for (const a of template.meta.assets ?? []) {
    const to = path.join(project, 'assets', a);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(ENGINE, '..', 'assets', a), to);
  }
  const pictures = template.images?.(ctx) ?? [];
  if (pictures.length) {
    const dir = path.join(project, 'assets/images');
    fs.mkdirSync(dir, { recursive: true });
    const rendered = await renderOverlays(pictures.map((p) => ({ html: p.html })), dir);
    rendered.forEach((r, i) => fs.renameSync(r.png, path.join(dir, `${pictures[i]!.name}.png`)));
  }
  const stylePath = path.join(project, 'source/style.json');
  fs.writeFileSync(stylePath, JSON.stringify({ version: 1, name: template.meta.id, creator: job.creator, ...template.style(ctx) }));
  fs.writeFileSync(path.join(project, 'source/spec.js'), `window.SPEC = ${JSON.stringify(template.spec(ctx), null, 1)};\n`);

  await engine(['prepare', project]);
  const res = await engine(['all', project]);
  const qc = res.stdout.split('\n').find((l) => l.includes('QC:'))?.replace('[short] ', '') ?? '';
  if (/decode (failed|error)/i.test(qc)) throw new Error(`QC failed: ${qc}`);
  const engineOut = path.join(project, 'output', `${path.basename(project)}.mp4`);

  // A frame with captions but no hook text yet: the background of the hook editor's live preview.
  await run('ffmpeg', ['-v', 'error', '-y', '-ss', '3', '-i', engineOut, '-frames:v', '1', '-q:v', '3', path.join(job.outDir, 'clean.jpg')]);
  const overlays = await renderOverlays(template.overlays?.(ctx) ?? [], path.join(project, 'files'));
  const output = path.join(job.outDir, 'final.mp4');
  await composite(engineOut, overlays, output);
  const poster = path.join(job.outDir, 'poster.jpg');
  await run('ffmpeg', ['-v', 'error', '-y', '-ss', '1', '-i', output, '-frames:v', '1', '-q:v', '3', poster]);
  if (!process.env.SHORTS_KEEP) {   // a clip's working frames weigh about 1 GB; only the final is kept
    for (const d of ['frames', '.cache', 'output']) fs.rmSync(path.join(project, d), { recursive: true, force: true });
  }
  const seconds = (Date.now() - t0) / 1000;
  log.info({ ...ctxLog, seconds }, 'Clip rendered');
  fs.writeFileSync(path.join(job.outDir, 'render.json'), JSON.stringify({ screenShare, template: template.meta.id, contentRect: template.meta.contentRect ?? null }));
  return { screenShare, template: template.meta.id, output, poster, duration: await probeDuration(output), seconds, qc };
}
