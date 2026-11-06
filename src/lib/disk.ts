import fs from 'node:fs';
import { DATA } from './config.ts';
import { Retry } from './jobs.ts';

const MIN_FREE_GB = 10;

export const freeGb = () => { const s = fs.statfsSync(DATA); return (s.bavail * s.bsize) / 1024 ** 3; };

/** A long run must pause, not corrupt clips or fill the Mac, when space runs out. */
export async function requireDisk(): Promise<void> {
  if (freeGb() < MIN_FREE_GB) throw new Retry(`Disque presque plein (${freeGb().toFixed(1)} Go libres), en pause`, 1800);
}
