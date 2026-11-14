// proof-stack: a full-screen vertical talking head. Each time the speaker names something that can be shown, the camera drops to
// the lower half and a dark stage opens above it with the proof: the real capture, a figure counting up, or the name of the tool.
// Between two proofs the speaker is full screen again, with punch-ins and, on a key idea, big words on the chest in place of the
// caption. Nothing ever covers the face. Camera clips only.
import { brand, brandCaptions, brandColors, brandFontFace, brandStyle } from '../brand.mjs';

const W = 1080, H = 1920;
const SEAM = 900;                                  // y of the stage / camera seam while a proof is shown
const ZONE = { x: 60, y: 92, w: 960, h: 690 };     // where a proof sits on the stage; nothing in the top 92 px
const ZONE_CY = ZONE.y + ZONE.h / 2;
const CAP_FACE = 1405, CAP_STACK = 1705;           // caption centre: on the chest when full screen, under the chin in split
const KEY_Y = 1400;                                // centre of the big words (band 1180 to 1620: chest, never the face)
const FACE_PX = 430;                               // face height in the camera half
const PAPER = '#0D0C0A', INK = '#FFFFFF';
const OPEN = 2.8;                                  // nothing but the hook and the captions before this
const LEAD = 0.16;                                 // a proof lands this long after the stage starts opening
const HOLD = 4.2, HOLD_MIN = 1.6;                  // how long one proof stays on the stage
const JOIN = 4.6;                                  // proofs closer than this share one stage opening
const FACE_MIN = 1.5;                              // at least this long full screen between two openings
const HOOK_END = 2.6;
const ZOOMS = [1.12, 1.0, 1.15, 1.04];             // punch-in levels, in turn (the engine's ceiling is 1.15)
const EM = 0.56;                                   // average glyph width in em, 800 weight at -4 % tracking

const clean = (s) => String(s ?? '').replace(/\*/g, '').replace(/[ \t\n]+/g, ' ').trim();
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const norm = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const keysOf = (t) => norm(t).split(' ').filter((x) => x.length >= 4 || /\d/.test(x));
const font = () => brand().font.family;
const accent = () => brandColors().accent;

// "700 000 € générés" -> counter 700000 + suffix "€" + tail "générés". Anything else stays text.
export const parseStat = (raw) => {
  const text = clean(raw);
  const m = text.match(/^(\+)?\s*(\d{1,3}(?:[  ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)\s*(%|€|\$|k|K|h)?\s*(.*)$/);
  if (!m) return null;
  const digits = m[2].replace(/[  ]/g, ''), dec = (digits.match(/[.,](\d+)$/) || [])[1];
  return { prefix: m[1] ? '+' : '', value: Number(digits.replace(',', '.')), decimals: dec ? dec.length : 0, suffix: m[3] ? (/[kKh]/.test(m[3]) ? m[3] : `\u00a0${m[3]}`) : '', tail: m[4].trim(), shown: m[2] };
};

/** The label shown above a capture: its file name, read as words. */
export const labelOf = (image) => { const t = image.tags.join(' ').trim(); return t ? t[0].toUpperCase() + t.slice(1) : ''; };

/**
 * What happens when, in TAKE seconds. `windows`: the stage openings, each with one proof at a time. `keys`: the big words on the
 * chest, full screen. A proof is a beat of kind stat or tool, or a capture whose file name is said out loud; a label beat is a key,
 * unless it falls in or right after an opening, where it becomes a stage card.
 */
export function plan(ctx) {
  const D = ctx.duration, cuts = ctx.cut ?? [];
  const inCut = (t) => cuts.some(([a, b]) => t >= a - 0.05 && t <= b + 0.05);
  const spokenAt = (t) => new Set(ctx.words.filter((w) => w.start >= t - 0.6 && w.start <= t + 1.2).flatMap((w) => keysOf(w.text)));
  const images = (ctx.broll ?? []).filter((b) => /\.(png|jpe?g|webp)$/i.test(b.path)).map((b) => ({ ...b, keys: b.tags.flatMap(keysOf) }));
  const used = new Set();
  const pick = (keys) => { const im = images.find((x) => !used.has(x.path) && x.keys.some((k) => keys.has(k))); if (im) used.add(im.path); return im ?? null; };

  let moments = [...ctx.beats].sort((a, b) => a.t - b.t).map((b) => {
    const text = clean(b.text);
    // only a named thing takes a capture (a figure counts, a key idea is words): by its own text first, then by the words said with it
    const image = b.kind !== 'tool' ? null : pick(new Set(keysOf(text))) ?? pick(spokenAt(b.t));
    return { t: b.t, kind: b.kind, text, image };
  });
  // a capture nobody attached to a beat still shows, on the first word that names it
  for (const im of images) {
    if (used.has(im.path)) continue;
    const trigger = keysOf(im.tags[0] ?? '');   // the first word of the file name is what must be said
    const w = ctx.words.find((x) => x.start >= OPEN && !inCut(x.start) && keysOf(x.text).some((k) => trigger.includes(k)));
    if (w) { used.add(im.path); moments.push({ t: w.start, kind: 'tool', text: labelOf(im), image: im }); }
  }
  moments = moments.filter((m) => m.text && m.t >= OPEN && m.t <= D - 1.4 && !inCut(m.t)).sort((a, b) => a.t - b.t);
  moments = moments.filter((m, i) => !i || m.t - moments[i - 1].t >= 1.2);

  const windows = [], keys = [];
  for (const [i, m] of moments.entries()) {
    const next = moments[i + 1]?.t ?? D - 0.4, last = windows.at(-1), prevEnd = last ? last.items.at(-1).t : -99;
    const near = m.t - prevEnd <= JOIN;
    if (m.kind === 'label' && !near) {
      const len = clamp(0.5 + 0.3 * m.text.split(' ').length, 1.0, 2.2);
      const to = Math.min(m.t + len, next - 0.15);
      if (to - m.t >= 0.7) keys.push({ t: m.t, to, text: m.text });
      continue;
    }
    if (near) last.items.push(m); else windows.push({ items: [m] });
  }
  const firstAfter = (t) => Math.min(...keys.filter((k) => k.t > t).map((k) => k.t), D);
  windows.forEach((w, i) => {
    const nextWin = windows[i + 1]?.items[0].t ?? Infinity;
    w.from = Math.max(OPEN - LEAD, w.items[0].t - LEAD);
    w.items.forEach((p, j) => {
      const nxt = w.items[j + 1]?.t;
      p.to = nxt ?? Math.max(p.t + HOLD_MIN, Math.min(p.t + HOLD, nextWin - LEAD - FACE_MIN, firstAfter(p.t) - 0.4, D - 0.5));
    });
    w.to = w.items.at(-1).to;
  });
  const inWin = (t, pad = 0) => windows.some((w) => t >= w.from - pad && t <= w.to + pad);
  return { windows: windows.filter((w) => w.to > w.from), keys: keys.filter((k) => !inWin(k.t, 0.3)), inWin };
}

// ---------------------------------------------------------------- pictures (full-frame alpha pages, content centred on 540, 960)
const page = (css, body) => `<style>${brandFontFace()}
.c{position:absolute;left:${(W - ZONE.w) / 2}px;top:${H / 2 - ZONE.h / 2}px;width:${ZONE.w}px;height:${ZONE.h}px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px;text-align:center;color:${INK};font-family:'${font()}'}
${css}</style>${body}`;

const glowHtml = () => `<div style="position:absolute;left:0;top:0;width:${W}px;height:${SEAM}px;background:radial-gradient(ellipse 80% 46% at 50% 0%,${accent()}33,${accent()}00 70%)"></div>`;

// The capture, whole, in a rounded window under its label. A wide capture fills the 880 px width, a tall one the 560 px height.
const captureHtml = (p) => page(`
.l{font-weight:800;font-size:${clamp(Math.floor(900 / (EM * Math.max(8, p.text.length))), 44, 62)}px;line-height:1.02;letter-spacing:-.04em;white-space:nowrap}
.s{max-width:880px;max-height:560px;border-radius:30px;border:2px solid rgba(255,255,255,.14);box-shadow:0 30px 70px rgba(0,0,0,.55);display:block}`,
`<div class="c"><div class="l">${esc(p.text)}</div><img class="s" src="file://${encodeURI(p.image.path)}"></div>`);

// Big words on the chest: the first line in the accent, the rest smaller in white, a soft dark shadow so they hold on any shirt.
const keyHtml = (k) => {
  const w = k.text.split(' '), cutAt = w.length <= 2 ? w.length : w.length === 3 ? (w[0].length <= 3 ? 2 : 1) : 2;
  const l1 = w.slice(0, cutAt).join(' '), l2 = w.slice(cutAt).join(' ');
  const size = Math.round(clamp(900 / (EM * Math.max(l1.length, l2.length * 0.62, 1)), 96, l2 ? 168 : 230));
  return `<style>${brandFontFace()}
.k{position:absolute;left:40px;top:${H / 2 - 220}px;width:1000px;height:440px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;font:800 ${size}px/.94 '${font()}';letter-spacing:-.05em;text-shadow:0 4px 0 rgba(0,0,0,.3),0 10px 40px rgba(0,0,0,.7),0 0 80px rgba(0,0,0,.45);white-space:nowrap}
.g{color:${accent()}}.w{color:#fff;font-size:.62em;letter-spacing:-.04em;margin-top:.06em}</style>
<div class="k"><div class="g">${esc(l1)}</div>${l2 ? `<div class="w">${esc(l2)}</div>` : ''}</div>`;
};

const numbered = (ctx) => {
  const p = plan(ctx);
  let n = 0;
  for (const w of p.windows) for (const it of w.items) if (it.image) it.png = `p${n++}`;
  p.keys.forEach((k, i) => { k.png = `k${i}`; });
  return p;
};

// ---------------------------------------------------------------- stage items (engine board), in TAKE seconds
// Largest size at which the text holds in `lines` lines of `maxW` px (greedy wrap estimate, as the engine will wrap it).
const linesAt = (text, size, maxW) => {
  const per = Math.max(1, Math.floor(maxW / (size * EM)));
  let lines = 1, cur = 0;
  for (const w of text.split(' ')) { if (w.length > per) return Infinity; if (cur && cur + 1 + w.length > per) { lines++; cur = w.length; } else cur += (cur ? 1 : 0) + w.length; }
  return lines;
};
const fitSize = (text, maxW, max, min, lines = 2) => { for (let z = max; z > min; z -= 4) if (linesAt(text, z, maxW) <= lines) return z; return min; };
const proofItems = (p) => {
  const at = p.t, to = p.to;
  if (p.image) return [{ k: 'img', at, to, img: `assets/images/${p.png}.png`, x: W / 2, y: ZONE_CY, s: W, h: H, shadow: false, rise: 44, pop: 0.95, slot: false }];
  const stat = p.kind === 'stat' ? parseStat(p.text) : null;
  if (stat) {
    const n = stat.prefix.length + stat.shown.length + stat.suffix.length;
    const size = clamp(Math.floor(860 / (0.6 * n)), 120, 190);
    const tail = stat.tail ? [{ k: 'text', at: at + 0.25, to, x: W / 2, y: ZONE_CY + size * 0.62 + 20, text: stat.tail, size: 42, weight: 600, maxW: 900, slot: false }] : [];
    return [{ k: 'counter', at, to, x: W / 2, y: ZONE_CY - (stat.tail ? 30 : 0), value: stat.value, decimals: stat.decimals, decSep: ',', prefix: stat.prefix, suffix: stat.suffix, size, countFrom: at, countTo: at + 0.85, color: 'blue', suffixColor: 'blue', hold: true, slot: false }, ...tail];
  }
  // a named thing with no capture: its name, large, over a short accent rule (never a fake logo or a fake screen)
  const size = fitSize(p.text, 900, 150, 70), rows = Math.min(2, linesAt(p.text, size, 900)), ruleY = ZONE_CY - 10 + rows * size * 0.52 + 40;
  return [
    { k: 'text', at, to, x: W / 2, y: ZONE_CY - 10, text: p.text, size, weight: 800, lh: size * 1.04, maxW: 900, slot: false },
    { k: 'line', at: at + 0.12, to, x: W / 2 - 130, y: ruleY, x2: W / 2 + 130, y2: ruleY, lw: 10, color: 'blue', dur: 0.4, slot: false },
  ];
};

const spec = (ctx) => {
  const { windows, keys, inWin } = numbered(ctx);
  const cw = ctx.take.w, ch = ctx.take.h;
  const s0 = Math.max(W / cw, (H - SEAM) / ch);
  const splitZoom = +clamp(FACE_PX / Math.max(1, ctx.face.faceH * s0), 1, 2.2).toFixed(3);

  const layoutKeys = [[0, 0]], yKeys = [[0, CAP_FACE]], scenes = [];
  for (const w of windows) {
    layoutKeys.push([w.from, SEAM], [w.to, 0]);
    yKeys.push([w.from, CAP_STACK], [w.to + 0.3, CAP_FACE]);
    // the warm glow of the stage, still, for the whole opening; then one board per proof on top of it
    scenes.push({ type: 'board', from: w.from, to: w.to, gate: false, push: 0, items: [{ k: 'img', at: w.from, shown: true, still: true, img: 'assets/images/glow.png', x: W / 2, y: H / 2, s: W, h: H, shadow: false, quiet: true, slot: false }] });
    for (const p of w.items) scenes.push({ type: 'board', from: p.t, to: p.to, gate: false, push: 0.02, pushAt: [W / 2, ZONE_CY], items: proofItems(p) });
  }
  for (const k of keys) {
    scenes.push({ type: 'board', layer: 'over', from: k.t, to: k.to, hard: true, gate: false, push: 0, items: [{ k: 'img', at: k.t, img: `assets/images/${k.png}.png`, x: W / 2, y: KEY_Y, s: W, h: H, shadow: false, rise: 0, pop: 1.28, w8: 30, slot: false }] });
  }

  // punch-ins: full screen only, on sentence starts, at least 3.2 s apart, clear of the openings and of the big words
  const zoomKeys = [[0, 1]];
  let lastZ = -99, zi = 0;
  const keyNear = (t) => keys.some((k) => t > k.t - 1 && t < k.to + 0.8);
  for (const t of ctx.punchIns ?? []) {
    if (t < 1.2 || t - lastZ < 3.2 || inWin(t, 0.9) || keyNear(t)) continue;
    zoomKeys.push([t, ZOOMS[zi++ % ZOOMS.length], 400]); lastZ = t;
  }
  for (const k of keys) zoomKeys.push([k.t, 1.15, 160], [k.to, 1.0, 300]);
  for (const w of windows) zoomKeys.push([w.from, 1.0, 300]);
  zoomKeys.sort((a, b) => a[0] - b[0]);

  return {
    title: clean(ctx.hook) || ctx.creator.name,
    cam: { crop: [0, 0, cw, ch], eyes: ctx.face.eyes, splitZoom, wb: false },
    cut: ctx.cut,
    grade: false,
    layout: { keys: layoutKeys, dur: 0.5, frame: { bleed: true, border: 0, r: 0, shadow: 0, m: 0, gap: 0, bottom: 0 } },
    zoom: { keys: zoomKeys, drift: 0.006 },
    scenes,
    actors: [],
    // white words with a soft shadow, the emphasised ones in the accent; hidden while the big words are on screen
    captions: { ...brandCaptions(CAP_FACE, { shadow: true, hi: accent(), size: 74, maxChars: 21 }), yKeys, replace: ctx.replace, emph: ctx.emph, hide: keys.map((k) => [k.t, k.to]) },
    mix: { sfx: -33 },
    sfx: { swish: 0.3, accents: 0 },
  };
};

// The hook, in a dark pill above the head for the first 2.6 s (final seconds). One *starred* word takes the accent.
const overlays = (ctx) => {
  if (!ctx.hook) return [];
  const text = clean(ctx.hook);
  const html = ctx.hook.split(/(\*[^*]+\*)/).filter(Boolean).map((p) => (p.startsWith('*') ? `<b>${esc(p.slice(1, -1))}</b>` : esc(p))).join('');
  const size = text.length <= 34 ? 44 : 38;
  return [{
    from: 0, to: HOOK_END,
    html: `<style>${brandFontFace()}
.w{position:absolute;left:0;top:140px;width:${W}px;display:flex;justify-content:center}
.p{max-width:940px;padding:22px 38px;border-radius:46px;background:rgba(13,12,10,.9);border:2px solid rgba(255,255,255,.16);box-shadow:0 14px 40px rgba(0,0,0,.35);color:#fff;font:700 ${size}px/1.14 '${font()}';letter-spacing:-.025em;text-align:center;text-wrap:balance}
.p b{color:${accent()};font-weight:800}</style><div class="w"><div class="p">${html}</div></div>`,
  }];
};

export default {
  meta: {
    id: 'proof-stack', label: 'Preuves en haut', vertical: true,
    description: 'Plein vertical ; à chaque preuve le visage descend et une scène sombre montre la vraie capture, le chiffre qui compte ou l\'outil nommé. Entre deux preuves : zooms et mots-clés en gros sur le torse.',
  },
  style: () => ({
    colors: { paper: PAPER, sheet: PAPER, ink: INK, ...brandColors() },
    ...brandStyle(),
    display: { font: font(), weight: 800, text: font(), flat: true },
    paper: { bg: 'flat', grain: 0, depth: 0 },
    pace: { speed: 1, tighten: { sentence: 0.1, comma: 0.06, word: 0.03, lead: 0.03, tail: 0.3 } },
    music: { mute: true },
  }),
  images: (ctx) => {
    const { windows, keys } = numbered(ctx);
    const proofs = windows.flatMap((w) => w.items).filter((p) => p.image);
    return [...(windows.length ? [{ name: 'glow', html: glowHtml() }] : []), ...proofs.map((p) => ({ name: p.png, html: captureHtml(p) })), ...keys.map((k) => ({ name: k.png, html: keyHtml(k) }))];
  },
  spec,
  overlays,
};
