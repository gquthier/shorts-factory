import type { z } from 'zod';
import { zodToJsonSchema } from './zod-json.ts';
import { Retry } from './jobs.ts';

export async function requestStructured<T extends z.ZodTypeAny>(key: string, opts: { model: string; system: string; prompt: string; schema: T; timeoutMs?: number }, fetchImpl: typeof fetch = fetch): Promise<z.infer<T>> {
  let response: Response;
  try {
    response = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 300_000), redirect: 'error',
      body: JSON.stringify({ model: opts.model, max_tokens: 8192, system: opts.system,
        messages: [{ role: 'user', content: opts.prompt }],
        tools: [{ name: 'submit_result', description: 'Return the requested structured result. This tool does not execute actions.', input_schema: zodToJsonSchema(opts.schema) }],
        tool_choice: { type: 'tool', name: 'submit_result' },
      }),
    });
  } catch { throw new Error('Anthropic : connexion interrompue ou délai dépassé.'); }
  if ([429, 529].includes(response.status)) throw new Retry('Limite Anthropic atteinte, reprise plus tard', 1800);
  if (!response.ok) throw new Error(`Anthropic HTTP ${response.status}. Vérifie la clé, les crédits et le modèle dans Démarrer.`);
  const data = await response.json() as { content?: { type: string; name?: string; input?: unknown }[] };
  const result = data.content?.find(c => c.type === 'tool_use' && c.name === 'submit_result');
  if (!result) throw new Error('Anthropic : résultat structuré absent.');
  return opts.schema.parse(result.input);
}
