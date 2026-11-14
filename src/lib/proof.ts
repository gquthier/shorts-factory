import fs from 'node:fs';
import path from 'node:path';

/**
 * The real captures for a clip: every image dropped in its `proof/` folder. The words of the file name are its tags: the
 * first one is the word that must be said, so `tarifs-page.png` shows when "tarifs" is said. Used by the proof-stack format.
 */
export const proofImages = (dir: string): { path: string; tags: string[] }[] =>
  !fs.existsSync(dir) ? [] : fs.readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort()
    .map((f) => ({ path: path.join(dir, f), tags: path.basename(f, path.extname(f)).split(/[-_ ]+/).filter(Boolean) }));
