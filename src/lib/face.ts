import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ENGINE } from './config.ts';
import { probeDuration, probeSize, run } from './sh.ts';

export interface FaceSample { t: number; cx: number; cy: number; w: number; h: number }
export interface FaceInfo {
  w: number; h: number; samples: FaceSample[];
  eyes: [number, number]; faceH: number; driftX: number; detected: boolean;
}

const median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1] ?? 0;

/** Samples frames and runs the engine's Apple Vision face tool. Largest face per frame. */
export async function probeFaces(video: string, fps = 2): Promise<FaceInfo> {
  const { w, h } = await probeSize(video);
  const dur = await probeDuration(video);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shorts-face-'));
  try {
    await run('ffmpeg', ['-v', 'error', '-y', '-i', video, '-vf', `fps=${fps},scale=${w}:${h}`, '-q:v', '4', path.join(dir, '%05d.jpg')]);
    const platform = await import(pathToFileURL(path.join(ENGINE, 'platform.mjs')).href) as { visionTool: (n: string) => { cmd: string; args: string[] } };
    const tool = platform.visionTool('faces');
    const out = path.join(dir, 'faces.json');
    const res = await run(tool.cmd, [...tool.args, dir, out]);
    const detected = !/ 0 detected/.test(res.stdout);
    const raw = JSON.parse(fs.readFileSync(out, 'utf8')) as number[][];
    const samples = raw.map((f, i): FaceSample => ({ t: Math.min(i / fps, dur), cx: f[0]!, cy: f[1]!, w: f[2]!, h: f[3]! })).filter((s) => s.h > 0);
    if (!samples.length) return { w, h, samples: [], eyes: [w / 2, h * 0.38], faceH: h * 0.3, driftX: 0, detected: false };
    const cx = median(samples.map((s) => s.cx));
    const cy = median(samples.map((s) => s.cy));
    const faceH = median(samples.map((s) => s.h));
    const xs = samples.map((s) => s.cx).sort((a, b) => a - b);
    const driftX = xs[Math.floor(xs.length * 0.95)]! - xs[Math.floor(xs.length * 0.05)]!;
    return { w, h, samples, eyes: [Math.round(cx), Math.round(cy - faceH * 0.22)], faceH, driftX, detected };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
