// Horizontal footage on black: hook fixed above, sentence-fragment captions on the lower part of the video,
// optional kicker (ctx.kicker) in the black band under it. Measured on @sergegatari (Oct 2026):
// video 1080x608 at y=656, hook Poppins ExtraBold ~56 px / 71 line, ending ~60 px above the video,
// captions white Medium ~50 px centred at y~1165, no box, no frame line.
import { brandCaptions, brandColors, brandCss, brandFontFace, brandStyle } from '../brand.mjs';

const VIDEO = { x: 0, y: 656, w: 1080, h: 608 };
const BLEED = 2; // the engine strokes a 3 px light border on the card; the card is drawn 2 px bigger and the overlay masks the rim
const clean = (s) => String(s ?? '').replace(/\*/g, '').replace(/[ \t\n]+/g, ' ').trim();
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Hook: 56 px up to ~46 chars, then shrinks so up to 12 words (~80 chars) still sit on 2 lines of 960 px.
export const hookSize = (hook) => clamp(Math.floor(56 * 46 / Math.max(46, hook.length) * 1.12), 36, 56);

export default {
  meta: { screenShare: true, contentRect: VIDEO, id: 'black-frame', label: 'Cadre noir', vertical: false, description: '16:9 sur fond noir, texte au-dessus (hook fixe), captions phrase sur la vidéo, kicker optionnel en dessous.' },
  style: () => ({
    ...brandStyle(),
    colors: { paper: '#000000', ink: '#FFFFFF', ...brandColors() },
    paper: { bg: 'flat', grain: 0, depth: 0 },
    pace: { speed: 1.03, tighten: { sentence: 0.1, comma: 0.06, word: 0.03, lead: 0.03, tail: 0.3 } },
    music: { mute: true },
    sfx: { mute: true, accents: 0 },
  }),
  spec: (ctx) => {
    const { eyes, faceH, driftX = 0, detected } = ctx.face;
    const fit = VIDEO.w / ctx.take.w;                       // base scale of the take on the card
    const want = detected ? (VIDEO.h * 0.36) / (faceH * fit) : 1.2;   // face ~36 % of the card height
    const roomX = driftX > 0 ? (ctx.take.w * 0.45) / driftX : 9;      // keep a speaker who sways inside the crop
    // Slides or a screen with a small webcam: show the content, not the face. The 7 % zoom pushes the
    // desktop menu bar and dock out of frame: they leak calendar events and notifications.
    const zoom = ctx.screenShare ? 1.07 : clamp(Math.min(want, Math.max(1.05, roomX)), 1.08, 1.6);
    return {
      title: clean(ctx.hook) || ctx.creator.name,
      cam: { crop: [0, 0, ctx.take.w, ctx.take.h], eyes: ctx.screenShare ? [ctx.take.w / 2, ctx.take.h * 0.5] : eyes, wb: !ctx.screenShare },
      cut: ctx.cut,
      grade: !ctx.screenShare,
      layout: { card: { x: VIDEO.x - BLEED, y: VIDEO.y - BLEED, w: VIDEO.w + 2 * BLEED, h: VIDEO.h + 2 * BLEED, r: 0, zoom, bias: ctx.screenShare ? 0.5 : 0.40, capY: ctx.screenShare ? 1345 : 1165 } },
      zoom: { keys: [[0, 1]] },
      scenes: [],
      actors: [],
      // phrase mode: fragments of 3 to 6 words cut where the sentence reads, never a lone word
      captions: { ...brandCaptions(ctx.screenShare ? 1345 : 1165), replace: ctx.replace, emph: [], hide: [] },
    };
  },
  overlays: (ctx) => {
    const hook = esc(clean(ctx.hook));
    const kicker = clean(ctx.kicker ?? process.env.SHORTS_KICKER);   // env only for dev renders: render.ts does not pass kicker yet
    const ks = kicker.length > 60 ? 34 : 40;
    const band = (y) => `<div style="position:absolute;left:0;width:1080px;top:${y}px;height:8px;background:#000"></div>`;
    return [{
      html: `<style>${brandFontFace()}
.h{position:absolute;left:60px;right:60px;bottom:${1920 - VIDEO.y + 62}px;color:#fff;${brandCss(hookSize(clean(ctx.hook)) + 4, 1.12)};text-align:center;text-wrap:balance}
.k{position:absolute;left:96px;right:96px;top:${VIDEO.y + VIDEO.h + 56}px;max-height:${ks * 1.3 * 2}px;overflow:hidden;color:rgba(255,255,255,.86);${brandCss(ks, 1.2)};text-align:center;text-wrap:balance}
</style>${band(VIDEO.y - 8)}${band(VIDEO.y + VIDEO.h)}<div class="h">${hook}</div>${kicker ? `<div class="k">${esc(kicker)}</div>` : ''}`,
    }];
  },
};
