import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { z } from 'zod';
import { zodToJsonSchema } from './zod-json.ts';
import { Retry } from './jobs.ts';
import { run } from './sh.ts';
import { getSecret } from './secrets.ts';
import { getSetting } from './db.ts';
import { requestStructured } from './anthropic.ts';

// Uses the local `claude` CLI, so calls run on the Claude subscription with no API key to manage.
// Empty cwd, no settings, no tools, no MCP: the model only sees the prompt, and a transcript cannot trigger anything.
const EMPTY_CWD = fs.mkdtempSync(path.join(os.tmpdir(), 'shorts-llm-'));

export async function askJson<T extends z.ZodTypeAny>(opts: { model: string; system: string; prompt: string; schema: T; timeoutMs?: number }): Promise<z.infer<T>> {
  if (getSetting('llm_provider', 'claude-cli') === 'anthropic') {
    const key = getSecret('SHORTS_FACTORY_ANTHROPIC');
    if (!key) throw new Error('Connecte Anthropic dans Démarrer, ou sélectionne Claude CLI.');
    return requestStructured(key, { ...opts, model: getSetting('anthropic_model', 'claude-sonnet-4-6') });
  }
  const args = [
    '-p', '--model', opts.model, '--output-format', 'json', '--no-session-persistence',
    '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--disable-slash-commands',
    '--system-prompt', opts.system, '--json-schema', JSON.stringify(zodToJsonSchema(opts.schema)),
  ];
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { stdout } = await run('claude', args, { cwd: EMPTY_CWD, input: opts.prompt, timeoutMs: opts.timeoutMs ?? 300_000 });
      const envelope = JSON.parse(stdout) as { structured_output?: unknown; result?: string; is_error?: boolean };
      if (envelope.is_error) throw new Error(`claude returned an error: ${String(envelope.result).slice(0, 300)}`);
      const raw = envelope.structured_output ?? JSON.parse(String(envelope.result).replace(/^```json\s*|\s*```$/g, ''));
      return opts.schema.parse(raw);
    } catch (error) {
      // A usage limit is not a failure of the clip: wait it out instead of burning the job's retries.
      if (error instanceof Error && /usage limit|rate limit|hit your limit|limit reached|overloaded|too many requests|\b429\b|\b529\b/i.test(error.message)) throw new Retry('Limite Claude atteinte, reprise plus tard', 1800);
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('LLM call failed');
}
