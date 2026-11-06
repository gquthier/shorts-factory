import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DATA, ROOT } from './config.ts';
import type { Frame } from './qa-rules.ts';
import { run } from './sh.ts';

const VISION_BIN = path.join(DATA, '.bin/vision');

export function visionTool(): string {
  const src = path.join(ROOT, 'tools/vision.swift');
  if (!fs.existsSync(VISION_BIN) || fs.statSync(VISION_BIN).mtimeMs < fs.statSync(src).mtimeMs) {
    fs.mkdirSync(path.dirname(VISION_BIN), { recursive: true });
    execFileSync('xcrun', ['swiftc', '-O', src, '-o', VISION_BIN], { stdio: 'ignore' });
  }
  return VISION_BIN;
}

/** Text and face of frames sampled across a video, in the pixels of a copy `width` wide. */
export async function sampleFrames(video: string, fps = 0.5, width = 960): Promise<Frame[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shorts-frames-'));
  try {
    await run('ffmpeg', ['-v', 'error', '-y', '-i', video, '-vf', `fps=${fps},scale=${width}:-2`, '-q:v', '4', path.join(dir, '%05d.jpg')]);
    const out = path.join(dir, 'vision.json');
    await run(visionTool(), [dir, out]);
    return (JSON.parse(fs.readFileSync(out, 'utf8')) as Omit<Frame, 't'>[]).map((f, i) => ({ ...f, t: i / fps }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
