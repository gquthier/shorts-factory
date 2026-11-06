import { execFileSync } from 'node:child_process';

// Secrets live in the macOS keychain only: never in the database, config files, logs or API responses.
const ACCOUNT = 'shorts-factory-open-source';
const testMemory = process.env.NODE_ENV === 'test' && process.env.SHORTS_SECRET_STORE === 'memory';
const memory = new Map<string, string>();

export function getSecret(service: string): string | null {
  if (testMemory) return memory.get(service) ?? null;
  if (process.env[service]) return process.env[service]!;
  try {
    return execFileSync('security', ['find-generic-password', '-a', ACCOUNT, '-s', service, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

export function setSecret(service: string, value: string): void {
  if (testMemory) { memory.set(service, value); return; }
  try { execFileSync('security', ['add-generic-password', '-U', '-a', ACCOUNT, '-s', service, '-w', value], { stdio: 'ignore' }); }
  catch { throw new Error('Impossible d’enregistrer dans le trousseau macOS. Déverrouille le trousseau et réessaie.'); }
}

export function deleteSecret(service: string): void {
  if (testMemory) { memory.delete(service); return; }
  if (process.env[service]) throw new Error('Cette clé vient de l’environnement : retire la variable puis redémarre l’application.');
  try { execFileSync('security', ['delete-generic-password', '-a', ACCOUNT, '-s', service], { stdio: 'ignore' }); } catch { /* already absent */ }
}
