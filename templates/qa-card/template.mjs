// Q&A card: black canvas, tight two-tone headline top-left, speaker in a big rounded card,
// a violet "Question" banner + white card pinned to the bottom of the video for the first seconds.
// Measured on @sergegatari wacsPnkpqdg (Nov 2026): headline + question card live ~2.4 s, the card then
// shrinks a little and goes; afterwards captions sit mid-card, one short line at a time.
// Safe zones respected: top 220, bottom 420 (content ends y=1500), right 140.
import { brandCaptions, brandColors, brandCss, brandFontFace, brandStyle, VIOLET } from '../brand.mjs';

const CARD = { x: 70, y: 510, w: 860, h: 960, r: 46 };
const BANNER_H = 84;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const words = (s) => s.trim().split(/\s+/).filter(Boolean);

/** Split a hook into [accent, rest]: text between *..*, else first ~40% of the words. */
function splitHook(hook) {
  const m = hook.match(/\*([^*]+)\*/);
  if (m) {
    const a = m[1].trim(), rest = hook.replace(m[0], '\u0000').split('\u0000');
    // accent first: "*How I Made* My first $4000?" ; accent mid-sentence stays inline
    if (rest[0].trim() === '') return { accent: a, rest: rest[1].trim() };
    return { inline: [rest[0], a, rest[1] ?? ''] };
  }
  const w = words(hook);
  if (w.length < 3) return { accent: '', rest: hook.trim() };
  const k = Math.max(1, Math.round(w.length * 0.4));
  return { accent: w.slice(0, k).join(' '), rest: w.slice(k).join(' ') };
}

/** Largest size (px) at which the given text blocks (each starts a new line) fit in the headline band. */
function headlineSize(parts) {
  const fit = (s, maxLines) => parts.reduce((a, p) => a + Math.max(1, Math.ceil(p.length * 0.55 * s / 850)), 0) <= maxLines;
  for (let s = 108; s >= 66; s -= 2) if (fit(s, 2)) return s;     // two lines like the reference
  for (let s = 80; s >= 48; s -= 2) if (fit(s, 3) && s * 3.12 <= 250) return s;
  return 48;
}
const questionSize = (n) => (n <= 6 ? 60 : n <= 9 ? 52 : n <= 12 ? 44 : 38);

export default {
  meta: { id: 'qa-card', label: 'Carte Q&R', vertical: true, description: 'Fond noir, titre violet et blanc, caméra en carte arrondie, bandeau "Question" au bas de la carte au début.' },
  style: () => ({
    colors: { paper: '#000000', ink: '#FFFFFF', ...brandColors() },
    ...brandStyle(),
    paper: { bg: 'flat', grain: 0, depth: 0 },
    pace: { speed: 1.03, tighten: { sentence: 0.1, comma: 0.06, word: 0.03, lead: 0.03, tail: 0.3 } },
    music: { mute: true },
    sfx: { mute: true, accents: 0 },
  }),
  spec: (ctx) => {
    const { eyes, faceH } = ctx.face;
    const base = Math.max(CARD.w / ctx.take.w, CARD.h / ctx.take.h);
    // Serge's face fills about half the card height
    const zoom = Math.min(2.4, Math.max(1, (CARD.h * 0.36) / (faceH * base)));
    return {
      title: ctx.hook.replace(/\*/g, '') || ctx.creator.name,
      cam: { crop: [0, 0, ctx.take.w, ctx.take.h], eyes, wb: true },
      cut: ctx.cut,
      grade: true,
      layout: { card: { ...CARD, zoom, bias: 0.27, capY: 1065 } },
      zoom: { keys: [[0, 1]] },
      scenes: [],
      actors: [],
      captions: { ...brandCaptions(1065), yKeys: ctx.question ? [[0, 1065], [Math.min(4.2, Math.max(2.2, 0.9 + ctx.question.trim().split(/\s+/).length * 0.28, (ctx.words[0]?.start ?? 0) + 0.4)) * 1.03 + 0.72, 1300]] : [[0, 1300]], replace: ctx.replace, emph: [], hide: [] },
    };
  },
  overlays: (ctx) => {
    const out = [];
    const css = `<style>${brandFontFace()}*{margin:0;box-sizing:border-box}</style>`;
    // headline, whole clip
    const h = splitHook(ctx.hook || '');
    const plain = ctx.hook.replace(/\*/g, '');
    const brk = !h.inline && h.accent && headlineSize([h.accent, h.rest]) >= 66;   // forced break only if it still fits 2 lines
    const size = headlineSize(brk ? [h.accent, h.rest] : [plain]);
    const hl = h.inline
      ? `${esc(h.inline[0])}<span style="color:${VIOLET}">${esc(h.inline[1])}</span>${esc(h.inline[2])}`
      : brk ? `<span style="color:${VIOLET}">${esc(h.accent)}</span><br>${esc(h.rest)}`
        : h.accent ? `<span style="color:${VIOLET}">${esc(h.accent)}</span> ${esc(h.rest)}` : esc(h.rest);
    if (plain) out.push({ html: `${css}<div style="position:absolute;left:84px;width:830px;top:238px;color:#fff;${brandCss(size, 1.04)};text-wrap:balance">${hl}</div>` });

    const q = (ctx.question || '').trim();
    if (!q) return out;
    const n = words(q).length;
    const qs = questionSize(n);
    const bottom = CARD.y + CARD.h;
    const whiteH = 80 + Math.max(1, Math.ceil(q.length * 0.56 * qs / 850)) * qs * 1.22;
    const block = (scale, opacity) => {
      const bh = BANNER_H, wh = whiteH, total = bh + wh;
      return `<div style="position:absolute;left:${CARD.x}px;width:${CARD.w}px;top:${bottom - total * scale}px;height:${total * scale}px;opacity:${opacity}">
        <div style="height:${bh * scale}px;background:${VIOLET};display:flex;align-items:center;justify-content:center;${brandCss(46 * scale, 1)};color:#fff">Question</div>
        <div style="height:${wh * scale}px;background:#fff;border-radius:0 0 ${CARD.r}px ${CARD.r}px;display:flex;align-items:center;justify-content:center;padding:0 ${44}px;text-align:center;font:700 ${qs * scale}px/1.2 'Bricolage Grotesque';color:#111;text-wrap:balance">${esc(q)}</div></div>`;
    };
    // visible long enough to read (final seconds), then a shrunk version, then gone
    const lead = (ctx.words[0]?.start ?? 0) / 1.03;
    const full = Math.min(4.2, Math.max(2.2, 0.9 + n * 0.28, lead + 0.4));
    out.push({ html: `${css}${block(1, 1)}`, from: 0, to: full });
    out.push({ html: `${css}${block(0.72, 1)}`, from: full, to: full + 0.7 });
    return out;
  },
};
