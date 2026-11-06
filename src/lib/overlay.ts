import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ENGINE } from './config.ts';
import { fontFaces, type Overlay } from './templates.ts';

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const require = createRequire(path.join(ENGINE, 'package.json'));

/** Renders overlay pages to transparent 1080x1920 PNGs with real CSS typography. */
export async function renderOverlays(overlays: Overlay[], dir: string): Promise<{ png: string; from?: number; to?: number }[]> {
  if (!overlays.length) return [];
  const { chromium } = require('playwright-core') as typeof import('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
    const out: { png: string; from?: number; to?: number }[] = [];
    for (const [i, o] of overlays.entries()) {
      const file = path.join(dir, `overlay-${i}.html`);
      fs.writeFileSync(file, `<!doctype html><meta charset="utf-8"><style>${fontFaces()}*{box-sizing:border-box;margin:0}html,body{width:1080px;height:1920px;background:transparent;overflow:hidden}</style>${o.html}`);
      await page.goto(`file://${file}`);
      await page.evaluate(() => document.fonts.ready);
      const png = path.join(dir, `overlay-${i}.png`);
      await page.screenshot({ path: png, omitBackground: true });
      out.push({ png, from: o.from, to: o.to });
    }
    return out;
  } finally {
    await browser.close();
  }
}

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
