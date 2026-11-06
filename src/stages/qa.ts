import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DATA, loadConfig } from '../lib/config.ts';
import { visionTool } from '../lib/vision.ts';
import { db } from '../lib/db.ts';
import { checkFrames, compareAudio, judgeAudio, judgeTech, judgeTics, qaStatus, type Box, type Finding, type Frame, type Timed } from '../lib/qa-rules.ts';
import { run } from '../lib/sh.ts';
import { countTics } from '../lib/tics.ts';
import { preciseWords } from '../lib/scribe.ts';
import { rateClip } from './autopilot.ts';

async function hearAgain(video: string, dir: string, lang: string): Promise<Timed[]> {
  const wav = path.join(dir, 'a.wav');
  const base = path.join(dir, 'heard');
  // Scribe when available: it hears tics, and whisper can hallucinate on some clips ("Sous-titres par ...").
  await run('ffmpeg', ['-v', 'error', '-y', '-i', video, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
  return (await preciseWords(wav, base, lang)).words;
}

async function readFrames(video: string, dir: string, fps = 2): Promise<Frame[]> {
  const frames = path.join(dir, 'frames');
  fs.mkdirSync(frames);
  await run('ffmpeg', ['-v', 'error', '-y', '-i', video, '-vf', `fps=${fps}`, '-q:v', '3', path.join(frames, '%05d.jpg')]);
  const out = path.join(dir, 'vision.json');
  await run(visionTool(), [frames, out]);
  const raw = JSON.parse(fs.readFileSync(out, 'utf8')) as Omit<Frame, 't'>[];
  return raw.map((f, i) => ({ ...f, t: i / fps }));
}

async function measure(video: string, screenShare: boolean) {
  const probe = JSON.parse((await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,codec_name:format=duration', '-of', 'json', video])).stdout) as { streams: { width: number; height: number; codec_name: string }[]; format: { duration: string } };
  const v = probe.streams[0]!;
  const loud = (await run('ffmpeg', ['-hide_banner', '-i', video, '-af', 'ebur128=peak=true:framelog=quiet,silencedetect=noise=-38dB:d=0.6', '-vn', '-f', 'null', '-'])).stderr;
  const lufs = Number(/ I:\s+(-?[\d.]+) LUFS/.exec(loud)?.[1] ?? NaN);
  const peak = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(loud)?.[1] ?? NaN);
  const silences = [...loud.matchAll(/silence_duration: ([\d.]+)/g)].map((m) => Number(m[1]));
  // Only the footage area can be "black": black-frame's bands are black by design.
  const area = v.width === 1080 && !screenShare ? 'crop=1080:608:0:656,' : '';
  const black = (await run('ffmpeg', ['-hide_banner', '-i', video, '-vf', `${area}blackdetect=d=0.2:pix_th=0.06`, '-an', '-f', 'null', '-'])).stderr;
  const blackSeconds = [...black.matchAll(/black_duration:([\d.]+)/g)].reduce((s, m) => s + Number(m[1]), 0);
  return {
    width: v.width, height: v.height, codec: v.codec_name, duration: Number(probe.format.duration),
    lufs: Number.isFinite(lufs) ? lufs : null, truePeak: Number.isFinite(peak) ? peak : null,
    longestSilence: Math.max(0, ...silences), blackSeconds: screenShare ? 0 : blackSeconds,
  };
}

export async function qaClip(video: string, captions: Timed[], o: { screenShare: boolean; contentRect?: Box | null; usesCenterVideo: boolean; lang: string }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shorts-qa-'));
  try {
    const [tech, heard, frames] = await Promise.all([measure(video, o.screenShare || !o.usesCenterVideo), hearAgain(video, dir, o.lang), readFrames(video, dir)]);
    const audio = compareAudio(captions, heard);
    const visual = checkFrames(frames, { captions, contentRect: o.screenShare ? o.contentRect ?? undefined : undefined });
    const tics = countTics(heard);
    const findings: Finding[] = [...judgeTech(tech), ...judgeAudio(audio), ...visual.findings, ...judgeTics(tics, tech.duration)];
    return { status: qaStatus(findings), findings, tech, audio: { ...audio, tics }, visual: { readableShare: visual.readableShare, mouthCovered: visual.mouthCovered, unsafe: visual.unsafe, frames: frames.length } };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export async function qa(id: string): Promise<void> {
  const c = db.prepare('SELECT output, template, approved_by FROM clips WHERE id = ?').get(id) as { output: string; template: string; approved_by: string | null };
  const timeline = JSON.parse(fs.readFileSync(path.join(DATA, 'clips', id, 'project/assets/timeline.json'), 'utf8')) as { words: Timed[] };
  const meta = JSON.parse(fs.readFileSync(path.join(DATA, 'clips', id, 'render.json'), 'utf8')) as { screenShare: boolean; contentRect: Box | null };
  const report = await qaClip(c.output, timeline.words, { screenShare: meta.screenShare, contentRect: meta.contentRect, usesCenterVideo: c.template === 'black-frame', lang: loadConfig().creator.lang });
  db.prepare('UPDATE clips SET qa = ?, qa_status = ?, status = ? WHERE id = ?').run(JSON.stringify(report), report.status, report.status === 'fail' ? 'qa_failed' : c.approved_by === 'manual' ? 'approved' : 'review', id);  // a clip he validated stays validated, unless the new version is broken
  rateClip(id);
  // Working files weigh more than the clip. The section stays, so a re-render never needs the network.
  const clipDir = path.join(DATA, 'clips', id);
  fs.rmSync(path.join(clipDir, 'take.mp4'), { force: true });
  for (const f of ['source.mp4', 'source.wav', 'voice.wav']) fs.rmSync(path.join(clipDir, 'project/assets', f), { force: true });
}
