import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { readProfile, profilePrompt } from './profile.ts';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DATA = process.env.SHORTS_DATA ?? path.join(ROOT, 'data');
export const ENGINE = path.join(ROOT, 'vendor/video-agent-skills/skills/short-editing/engine');
export const WHISPER_MODEL = process.env.WHISPER_MODEL ?? path.join(process.env.HOME ?? '', 'whisper-models/ggml-large-v3-turbo.bin');
export const RESEARCH = path.join(DATA, 'research');

export const SOURCE_KINDS = ['youtube', 'live', 'upload', 'masterclass', 'qa'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

const ConfigSchema = z.object({
  creator: z.object({ name: z.string(), lang: z.string(), niche: z.string() }),
  targets: z.object({
    clipsPerDay: z.number().int().positive(),
    minDur: z.number().positive(),
    maxDur: z.number().positive(),
    minHookScore: z.number().min(0).max(100),
    maxClipsPerSourceHour: z.number().int().positive(),
    editAboveSeconds: z.number().positive(),   // talk longer than this gets shortened
    targetSeconds: z.number().positive(),
    maxSeconds: z.number().positive(),
  }),
  glossary: z.array(z.tuple([z.string(), z.string()])),
  llm: z.object({ miner: z.string(), hooks: z.string(), judge: z.string() }),
  concurrency: z.object({ io: z.number(), whisper: z.number(), llm: z.number(), render: z.number() }),
  templateMix: z.record(z.array(z.string())),
  accounts: z.array(z.object({ account: z.string(), maxPerDay: z.number().int().positive() })),
});
export type Config = z.infer<typeof ConfigSchema>;

export const loadConfig = (): Config => {
  const config = ConfigSchema.parse(JSON.parse(fs.readFileSync(path.join(ROOT, 'factory.config.json'), 'utf8')));
  const profile = readProfile(DATA);
  if (profile) config.creator = { name: profile.name, lang: profile.lang, niche: profile.niche };
  return config;
};
export const creatorInstructions = () => {
  const profile = readProfile(DATA);
  return profile ? profilePrompt(profile) : 'Respecte la voix présente dans la transcription et sa langue. Aucun profil créateur personnalisé.';
};
