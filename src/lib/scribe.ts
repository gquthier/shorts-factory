import fs from 'node:fs';
import { WHISPER_MODEL } from './config.ts';
import { getSecret } from './secrets.ts';
import { run } from './sh.ts';
import type { Word } from './transcript.ts';

export const SCRIBE_SECRET = 'SHORTS_FACTORY_ELEVENLABS';
const ENDPOINT = 'https://api.elevenlabs.io/v1/speech-to-text';

interface ScribeWord { text: string; start: number; end: number; type: string }

export const wordsFromScribe = (raw: { words?: ScribeWord[] }): Word[] =>
  (raw.words ?? []).filter((w) => w.type === 'word' && w.text.trim()).map((w) => ({ text: w.text.trim(), start: w.start, end: w.end }));

async function scribe(wav: string, key: string, lang: string): Promise<Word[]> {
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const form = new FormData();
      form.append('model_id', 'scribe_v1');
      form.append('language_code', lang);
      form.append('timestamps_granularity', 'word');
      form.append('tag_audio_events', 'false');
      form.append('diarize', 'false');
      form.append('file', new Blob([fs.readFileSync(wav)], { type: 'audio/wav' }), 'clip.wav');
      const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'xi-api-key': key }, body: form, signal: AbortSignal.timeout(180_000) });
      if (res.status === 401 || res.status === 403) throw new Error(`ElevenLabs a refusé la clé (HTTP ${res.status})`);
      if (!res.ok) throw new Error(`ElevenLabs HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return wordsFromScribe(await res.json() as { words?: ScribeWord[] });
    } catch (error) {
      last = error;
      if (error instanceof Error && /refusé la clé/.test(error.message)) throw error;
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
  throw last instanceof Error ? last : new Error('Scribe failed');
}

/** Free fallback without a key. Much less accurate on timing and it smooths over hesitations: the QA will show it. */
async function whisperWords(wav: string, base: string, lang: string): Promise<Word[]> {
  await run('whisper-cli', ['-m', WHISPER_MODEL, '-f', wav, '-l', lang, '-t', '6', '-oj', '-of', base, '-np', '-ml', '1', '-sow']);
  const raw = JSON.parse(fs.readFileSync(`${base}.json`, 'utf8')) as { transcription: { text: string; offsets: { from: number; to: number } }[] };
  return raw.transcription.filter((s) => s.text.trim()).map((s) => ({ text: s.text.trim(), start: s.offsets.from / 1000, end: s.offsets.to / 1000 }));
}

/** Precise word timings for one clip's audio. Used for every cut and every caption. */
export async function preciseWords(wav: string, tmpBase: string, lang: string): Promise<{ words: Word[]; engine: 'scribe' | 'whisper' }> {
  const key = getSecret(SCRIBE_SECRET);
  return key ? { words: await scribe(wav, key, lang === 'fr' ? 'fra' : lang), engine: 'scribe' } : { words: await whisperWords(wav, tmpBase, lang), engine: 'whisper' };
}
