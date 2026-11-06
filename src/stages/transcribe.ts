import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, WHISPER_MODEL } from '../lib/config.ts';
import { db } from '../lib/db.ts';
import { run } from '../lib/sh.ts';
import { sentencesFromWords, wordsFromWhisper } from '../lib/transcript.ts';
import { sourceDir } from './ingest.ts';

// A prompt full of hesitations makes whisper keep them, so the editor can cut them (from Melvynx's engine).
const VERBATIM = "Euh, alors, j'ai, j'ai testé tous les, euh, tous les.";

export async function transcribe(id: string): Promise<void> {
  const dir = sourceDir(id);
  const wav = path.join(dir, 'audio16k.wav');
  const base = path.join(dir, 'whisper');
  const video = path.join(dir, 'source.mp4');
  const audio = path.join(dir, 'audio.m4a');
  if (fs.existsSync(path.join(dir, 'words.json'))) { db.prepare("UPDATE sources SET status = 'transcribed' WHERE id = ?").run(id); return; }
  await run('ffmpeg', ['-v', 'error', '-y', '-i', fs.existsSync(video) ? video : audio, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
  await run('whisper-cli', ['-m', WHISPER_MODEL, '-f', wav, '-l', loadConfig().creator.lang, '-t', '8', '-ojf', '-of', base, '-np', '--prompt', VERBATIM]);
  const words = wordsFromWhisper(JSON.parse(fs.readFileSync(`${base}.json`, 'utf8')));
  if (!words.length) throw new Error('Transcription returned no words');
  fs.writeFileSync(path.join(dir, 'words.json'), JSON.stringify(words));
  fs.writeFileSync(path.join(dir, 'sentences.json'), JSON.stringify(sentencesFromWords(words)));
  fs.rmSync(wav);
  fs.rmSync(audio, { force: true });   // what's needed now is in words.json
  fs.rmSync(`${base}.json`);
  db.prepare("UPDATE sources SET status = 'transcribed' WHERE id = ?").run(id);
}
