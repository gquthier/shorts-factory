// Full vertical talk: the face fills the lower two thirds, one white bold sentence (the hook) stays the whole clip in the
// upper part over a soft dark gradient. Model: @sergegatari car selfie "The game is changing." (ig-grid.jpg): hook centred
// near y~600/1920, head top ~860, eyes ~1190, no word captions visible on the still.
// Safe zones kept free of text: top 220, bottom 420, right 140 (and left 140 to stay centred).
import { brand, brandCaptions, brandColors, brandFontFace, brandStyle } from '../brand.mjs';

const W = 1080, H = 1920, BLEED = 4;
const EYES_Y = 985;          // where the eyes land on screen
const FACE_PX = 560;          // target face-box height on screen: tight, no empty wall around him
const clean = (s) => String(s ?? '').replace(/\*/g, '').replace(/[ \t\n]+/g, ' ').trim();
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// 84 px for a short sentence, 60 px at the longest: the hook must read at a glance on a phone.
export const hookSize = (hook) => clamp(Math.floor(84 * 34 / Math.max(34, hook.length)), 60, 84);

export default {
  meta: { id: 'selfie-headline', label: 'Selfie + phrase', vertical: true, description: 'Plein cadre vertical, visage en bas, une phrase blanche en haut sur dégradé sombre pendant tout le clip.' },
  style: () => ({
    ...brandStyle(),
    colors: { paper: '#000000', ink: '#FFFFFF', ...brandColors() },
    paper: { bg: 'flat', grain: 0, depth: 0 },
    pace: { speed: 1.02, tighten: { sentence: 0.12, comma: 0.08, word: 0.05, lead: 0.05, tail: 0.3 } },   // tighter than this chops his first words
    music: { mute: true },
    sfx: { mute: true, accents: 0 },
  }),
  spec: (ctx) => {
    const { eyes, faceH, detected } = ctx.face;
    const cw = ctx.take.w, ch = ctx.take.h;
    const s0 = Math.max((W + 2 * BLEED) / cw, (H + 2 * BLEED) / ch);
    const byFace = detected ? FACE_PX / (faceH * s0) : 1.25;
    const byEyes = EYES_Y / (eyes[1] * s0);               // enough zoom for the eyes to reach EYES_Y without hitting the image top
    const zoom = clamp(Math.max(byFace, byEyes, 1), 1, 2.2);
    return {
      title: clean(ctx.hook) || ctx.creator.name,
      cam: { crop: [0, 0, cw, ch], eyes, wb: true },
      cut: ctx.cut,
      grade: true,
      // the card is the whole screen, drawn 4 px oversize so the engine's 3 px card outline stays off screen
      layout: { card: { x: -BLEED, y: -BLEED, w: W + 2 * BLEED, h: H + 2 * BLEED, r: 0, zoom, bias: (EYES_Y + BLEED) / (H + 2 * BLEED) } },
      zoom: { keys: [[0, 1]] },
      scenes: [],
      actors: [],
      captions: { ...brandCaptions(1425), replace: ctx.replace, emph: [], hide: [] },   // most people watch muted
    };
  },
  overlays: (ctx) => {
    if (!ctx.hook) return [];
    const hook = clean(ctx.hook);
    const { font } = brand();
    return [{
      html: `<style>${brandFontFace()}
.g{position:absolute;left:0;top:0;width:${W}px;height:1150px;background:linear-gradient(to bottom,rgba(0,0,0,.66) 0,rgba(0,0,0,.5) 380px,rgba(0,0,0,.2) 760px,rgba(0,0,0,0) 1150px)}
.h{position:absolute;left:100px;right:100px;bottom:${H - 650}px;color:#fff;font:${font.hookWeight} ${Math.round(hookSize(hook) * font.hookScale)}px/1.08 '${font.family}';letter-spacing:${font.hookTracking};${font.hookUpper ? 'text-transform:uppercase;' : ''}text-align:center;text-wrap:balance;text-shadow:0 2px 18px rgba(0,0,0,.45)}
</style><div class="g"></div><div class="h">${esc(hook)}</div>`,
    }];
  },
};
