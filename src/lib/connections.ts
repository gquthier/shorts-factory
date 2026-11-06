import { z } from 'zod';
import { getSecret, setSecret, deleteSecret } from './secrets.ts';

export const SERVICES = {
  anthropic: { label: 'Anthropic', secret: 'SHORTS_FACTORY_ANTHROPIC', url: 'https://api.anthropic.com/v1/models?limit=100', console: 'https://console.anthropic.com/settings/keys' },
  elevenlabs: { label: 'ElevenLabs', secret: 'SHORTS_FACTORY_ELEVENLABS', url: 'https://api.elevenlabs.io/v1/user', console: 'https://elevenlabs.io/app/settings/api-keys' },
  trypost: { label: 'TryPost', secret: 'SHORTS_FACTORY_TRYPOST', url: 'https://app.trypost.it/api/social-accounts', console: 'https://app.trypost.it' },
  apify: { label: 'Apify', secret: 'SHORTS_FACTORY_APIFY', url: 'https://api.apify.com/v2/users/me', console: 'https://console.apify.com/settings/integrations' },
} as const;
export type SecretStore = { get: (name: string) => string | null; set: (name: string, value: string) => void; delete: (name: string) => void };
const keychain: SecretStore = { get: getSecret, set: setSecret, delete: deleteSecret };
export const ServiceId = z.enum(['anthropic', 'elevenlabs', 'trypost', 'apify']);
export const connectionStatus = (store: SecretStore = keychain) => Object.entries(SERVICES).map(([id, s]) => ({ id, label: s.label, console: s.console, connected: !!store.get(s.secret) }));
export async function connectService(service: string, input: string, deps: { store?: SecretStore; fetchImpl?: typeof fetch } = {}) {
  const id = ServiceId.parse(service), apiKey = z.string().trim().min(8).max(4000).regex(/^[^\s]+$/).parse(input);
  const s = SERVICES[id];
  const headers: Record<string,string> = { Accept: 'application/json' };
  if (id === 'anthropic') { headers['x-api-key'] = apiKey; headers['anthropic-version'] = '2023-06-01'; }
  else if (id === 'elevenlabs') headers['xi-api-key'] = apiKey;
  else headers.Authorization = `Bearer ${apiKey}`;
  let response: Response;
  try { response = await (deps.fetchImpl ?? fetch)(s.url, { headers, signal: AbortSignal.timeout(15_000), redirect: 'error' }); }
  catch { throw new Error(`${s.label} : connexion impossible. Vérifie ta connexion et réessaie.`); }
  if (!response.ok) throw new Error(`${s.label} : ${response.status === 401 || response.status === 403 ? 'clé refusée ou permissions insuffisantes' : `service indisponible (HTTP ${response.status})`}.`);
  let data: { data?: { id?: string }[] };
  try { data = await response.json() as typeof data; }
  catch { throw new Error(`${s.label} : réponse du service illisible. Aucune clé enregistrée.`); }
  (deps.store ?? keychain).set(s.secret, apiKey);
  return { id, connected: true, ...(id === 'anthropic' ? { models: (data.data ?? []).map(m => m.id).filter((m): m is string => !!m) } : {}) };
}
export function disconnectService(service: string) { keychain.delete(SERVICES[ServiceId.parse(service)].secret); }
