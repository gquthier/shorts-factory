import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { DATA, WHISPER_MODEL } from './config.ts';
import { readProfile } from './profile.ts';
import { connectionStatus } from './connections.ts';
import { getSetting } from './db.ts';

const installed = (command: string, args = ['--version']) => {
  try { return spawnSync(command, args, { stdio: 'ignore', timeout: 3000 }).status === 0; } catch { return false; }
};
export const setupStatus = () => ({
  profile: readProfile(DATA), services: connectionStatus(),
  provider: getSetting('llm_provider', 'claude-cli'), model: getSetting('anthropic_model', 'claude-sonnet-4-6'),
  tools: [
    { name: 'FFmpeg', ready: installed('ffmpeg', ['-version']), hint: 'brew install ffmpeg' },
    { name: 'yt-dlp', ready: installed('yt-dlp'), hint: 'brew install yt-dlp' },
    { name: 'Whisper', ready: installed('whisper-cli', ['--help']) && fs.existsSync(WHISPER_MODEL), hint: 'npm run setup' },
    { name: 'Claude CLI', ready: installed('claude'), hint: 'Optionnel avec une clé Anthropic. Sinon : claude auth login' },
    { name: 'Apple Vision', ready: process.platform === 'darwin' && installed('xcrun', ['--find', 'swiftc']), hint: 'xcode-select --install' },
  ],
});
