// The hook as the template will draw it, for the editor's live preview: same HTML, same fonts, over a frame of the clip.
import fs from 'node:fs';
import path from 'node:path';
import { DATA, ROOT } from './config.ts';
import { run } from './sh.ts';
import { loadTemplate, type TemplateCtx } from './templates.ts';
import { frenchSpacing } from './transcript.ts';

const FONTS = path.join(ROOT, 'assets/fonts');
const BLACK_BAND_TOP = 648;   // black-frame: everything above the video is plain black

const webFonts = (html: string) => html.replaceAll(`file://${FONTS}/`, '/fonts/');

/** Which frame to draw on. Without a clean frame (clips made before the editor existed), the old hook is hidden where the layout allows it. */
async function background(id: string, template: string): Promise<{ src: string; mask: string }> {
  const dir = path.join(DATA, 'clips', id);
  const clean = path.join(dir, 'clean.jpg');
  // Cinema shows the hook only for its first seconds: a later frame of the finished clip is already clean.
  if (!fs.existsSync(clean) && template === 'cinema-talk' && fs.existsSync(path.join(dir, 'final.mp4'))) {
    await run('ffmpeg', ['-v', 'error', '-y', '-ss', '3.2', '-i', path.join(dir, 'final.mp4'), '-frames:v', '1', '-q:v', '3', clean]);
  }
  if (fs.existsSync(clean)) return { src: `/media/${id}/clean.jpg`, mask: '' };
  if (template === 'black-frame') return { src: `/media/${id}/poster.jpg`, mask: `<div style="position:absolute;left:0;top:0;width:1080px;height:${BLACK_BAND_TOP}px;background:#000"></div>` };
  return { src: `/media/${id}/poster.jpg`, mask: '' };
}

export async function hookPreview(clip: { id: string; template: string; question: string | null }, hook: string, creator: { name: string; lang: string }, layer = false): Promise<string> {
  const template = await loadTemplate(clip.template);
  const ctx = { hook: frenchSpacing(hook), question: clip.question ? frenchSpacing(clip.question) : undefined, creator, words: [], beats: [], emph: [], replace: [], cut: [], broll: [], punchIns: [] } as unknown as TemplateCtx;
  // Only what shows at the start: the hook layer, not later beats.
  const layers = (template.overlays?.(ctx) ?? []).filter((o) => !o.from);
  // Layer mode sits over the playing video, whose old hook is burned in: hide it where the layout allows.
  const bg = layer ? { src: '', mask: clip.template === 'black-frame' ? `<div style="position:absolute;left:0;top:0;width:1080px;height:${BLACK_BAND_TOP}px;background:#000"></div>` : '' } : await background(clip.id, clip.template);
  return `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:1080px;height:1920px;overflow:hidden;background:${layer ? 'transparent' : '#000'}}</style>
${bg.src ? `<img src="${bg.src}" alt="" style="position:absolute;left:0;top:0;width:1080px;height:1920px;object-fit:cover">` : ''}${bg.mask}
${layers.map((o) => `<div style="position:absolute;left:0;top:0;width:1080px;height:1920px">${webFonts(o.html)}</div>`).join('\n')}`;
}

export const fontFile = (name: string): string | null => {
  const file = path.join(FONTS, path.basename(name));
  return /\.(ttf|otf|woff2?)$/i.test(file) && fs.existsSync(file) ? file : null;
};
