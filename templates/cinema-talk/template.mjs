// Full vertical talk, with restrained typography: thin uppercase captions mid-frame, hard-cut punch-ins, hook text in the first 2.6 s.
import { brandCaptions, brandColors, brandCss, brandFontFace, brandStyle } from '../brand.mjs';

import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const clean = (s) => s.replace(/\*/g, '');
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const HOOK_END = 2.6;

// Jump-cut rhythm from the transcript: a cut at each phrase boundary, at least `gap` s apart, alternating wide / tight.
function cutTimes(words, punch, gap = 2.3) {
  const pts = new Set(punch);
  words.forEach((w, i) => {
    const p = words[i - 1];
    if (i && (/[.!?…,;:]$/.test(p.text) || w.start - p.end > 0.25)) pts.add(+w.start.toFixed(3));
  });
  const out = [];
  for (const t of [...pts].sort((a, b) => a - b)) if (t - (out.at(-1) ?? -gap) >= gap && t > 0.8) out.push(t);
  return out;
}

export default {
  meta: { id: 'cinema-talk', label: 'Cinema talk', vertical: true, description: 'Plein vertical, sous-titres fins en majuscules, jump-cuts, hook texte.' },
  style: () => ({
    colors: { paper: '#000000', ink: '#FFFFFF', ...brandColors() },
    ...brandStyle(),
    paper: { bg: 'flat', grain: 0, depth: 0 },
    pace: { speed: 1.03, tighten: { sentence: 0.1, comma: 0.06, word: 0.03, lead: 0.03, tail: 0.3 } },
    music: { mute: true },
    sfx: { mute: true, accents: 0 },
  }),
  spec: (ctx) => {
    const cuts = cutTimes(ctx.words, ctx.punchIns);
    const keys = [[0, 1]];
    cuts.forEach((t, i) => keys.push([t, i % 2 === 0 ? 1.12 : 1.0, 400]));
    return {
      title: clean(ctx.hook) || ctx.creator.name,
      cam: { crop: [0, 0, ctx.take.w, ctx.take.h], eyes: ctx.face.eyes, wb: true },
      cut: ctx.cut,
      grade: 'eq=contrast=1.07:saturation=0.94:gamma=1.0,vignette=angle=PI/5',
      layout: { keys: [[0, 0]] },
      zoom: { keys, drift: 0.006 },
      scenes: [],
      actors: [],
      captions: { ...brandCaptions(1415), replace: ctx.replace, emph: [], hide: [] },
    };
  },
  overlays: (ctx) => {
    if (!ctx.hook) return [];
    const parts = ctx.hook.split(/(\*[^*]+\*)/).filter(Boolean);
    const html = parts.map((p) => p.startsWith('*') ? `<span class="k">${esc(p.slice(1, -1))}</span>` : esc(p)).join(' ');
    return [{
      from: 0, to: HOOK_END,
      html: `<style>${brandFontFace()}
.h{position:absolute;left:110px;right:160px;top:250px;color:#fff;${brandCss(60, 1.1)};text-align:center;text-shadow:0 2px 18px rgba(0,0,0,.55)}
.k{display:inline-block;background:#fff;color:#111;font:italic 400 50px/1.1 'Times New Roman',Georgia,serif;letter-spacing:0;text-transform:none;padding:4px 18px 8px;margin:0 4px;text-shadow:none}
</style><div class="h">${html}</div>`,
    }];
  },
};
