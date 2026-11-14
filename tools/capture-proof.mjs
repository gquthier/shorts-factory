// Captures a public page, or one element of it, as a sharp image for the proof-stack format. No login, no cookies kept.
//   node tools/capture-proof.mjs <url> <out.png> [--selector "css"] [--clip x,y,w,h] [--width 1280] [--scale 3] [--wait 2500]
// Save the result in the clip's proof/ folder, named after the word that is said: data/clips/<id>/proof/tarifs-page.png
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = path.join(ROOT, 'vendor/video-agent-skills/skills/short-editing/engine');
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [url, out, ...rest] = process.argv.slice(2);
const opt = (name, fallback) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : fallback; };
if (!/^https?:\/\//.test(url ?? '') || !out) { console.error('Usage: node tools/capture-proof.mjs <url> <out.png> [--selector "css"] [--clip x,y,w,h] [--width 1280] [--scale 3] [--wait 2500]'); process.exit(1); }

const require = createRequire(path.join(ENGINE, 'package.json'));
const { chromium } = require('playwright-core');
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: Number(opt('width', 1280)), height: 1000 }, deviceScaleFactor: Number(opt('scale', 3)) });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(Number(opt('wait', 2500)));
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const selector = opt('selector'), clip = opt('clip');
  if (selector) await page.locator(selector).first().screenshot({ path: out });
  else if (clip) { const [x, y, width, height] = clip.split(',').map(Number); await page.screenshot({ path: out, fullPage: true, clip: { x, y, width, height } }); }
  else await page.screenshot({ path: out, fullPage: true });
  console.log(JSON.stringify({ out: path.resolve(out), bytes: fs.statSync(out).size }));
} finally {
  await browser.close();
}
