// split-board: visual on a dark flat stage on top, the speaker in a camera card below a fixed seam (y 1000).
// Safe zones kept free of text: top 220, bottom 420, right 140 (y 900 to 1700).
import { brand, brandCaptions, brandStyle, VIOLET } from '../brand.mjs';

const W = 1080, H = 1920;
const SEAM = 1000;                         // y of the stage / camera seam (brief: 960 to 1040)
const CARD_H = H - SEAM;
const FACE_PX = 330;                       // target face-box height on screen, in the 920 px card
const STAGE_Y = 585;                       // vertical centre of hooks and beats, inside the 220..900 free band
const SHARE_Y = 760;                       // same, while the screen is shown over the whole frame (camera hidden)
const PAPER = '#0A0B0E', INK = '#F6F2EA', ACCENT = VIOLET, ON_ACCENT = '#FFFFFF';   // ink 17:1, accent 11:1 on paper, 11:1 under dark text
const EM = 0.575;                          // average glyph width in em, Inter 800 at -3 % tracking (digits are wider)
const clean = (s) => String(s ?? '').replace(/\*/g, '').replace(/[ \t\n]+/g, ' ').trim();
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Words that sit between *stars* in the hook, matched token for token by the engine's `emph`.
export const starred = (hook) => {
  const out = [];
  for (const m of String(hook ?? '').matchAll(/\*([^*]+)\*/g)) out.push(...m[1].trim().split(/\s+/));
  return out;
};

// Estimated greedy wrap, to pick a size before the engine wraps for real.
const wrapCount = (text, size, maxW) => {
  const per = Math.max(1, Math.floor(maxW / (size * EM)));
  let lines = 1, cur = 0;
  for (const w of text.split(' ')) {
    const len = w.length;
    if (cur && cur + 1 + len > per) { lines++; cur = len; } else cur += (cur ? 1 : 0) + len;
    if (len > per) return Infinity;       // a single word wider than the line
  }
  return lines;
};
export const fitSize = (text, { maxW = 900, maxLines = 3, max = 260, min = 90 } = {}) => {
  for (let s = max; s >= min; s -= 4) if (wrapCount(text, s, maxW) <= maxLines) return s;
  return min;
};

// "113 clics" -> counter 113 + unit "clics". "1 milliard", "213 €", "3,5 %". Anything else (1/8 de la planète) stays text.
export const parseStat = (raw) => {
  const text = clean(raw);
  const m = text.match(/^(\d{1,3}(?:[  ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)\s*(%|€|\$)?\s*(.*)$/);
  if (!m) return null;
  const digits = m[1].replace(/[  ]/g, ''), dec = (digits.match(/[.,](\d+)$/) || [])[1];
  const rest = m[3].trim();
  if (rest.length > 18) return null;
  return { value: Number(digits.replace(',', '.')), decimals: dec ? dec.length : 0, suffix: m[2] || '', unit: rest, shown: m[1] };
};

const STAGE_SCALE = [[0, 1.06], [0.02, 1]];   // lands 6 % big and settles: a hit, not a bounce

const hookItem = (ctx, at, y) => {
  const text = clean(ctx.hook);
  if (!text) return [];
  const q = clean(ctx.question);
  const size = fitSize(text, { maxW: 880, maxLines: q ? 3 : 4, max: 124, min: 70 });
  const em = starred(ctx.hook);
  const numTok = text.split(' ').find((w) => /\d/.test(w));
  const lh = size * 1.06, hh = Math.min(4, wrapCount(text, size, 880)) * lh;
  const kQ = 42, kh = q ? wrapCount(q, kQ, 880) * kQ * 1.15 : 0, gap = q ? 46 : 0;
  const top = y - (hh + kh + gap) / 2;
  const items = [{ k: 'text', at, shown: true, x: W / 2, y: top + kh + gap + hh / 2, text, size, weight: 800, lh, maxW: 880, emph: (em.length ? em : numTok ? [numTok] : []).join(' '), scaleKeys: [[at, 1]] }];
  if (q) items.unshift({ k: 'text', at, shown: true, x: W / 2, y: top + kh / 2, text: q, size: kQ, weight: 700, lh: kQ * 1.15, maxW: 880, color: 'blue' });
  return items;
};

// One beat = one item on the stage. kind stat: huge number (counter when it starts with a plain number); tool: big label with
// an accent rule drawn under it (no logo files, never a fake logo); label: a big word.
const beatItems = (beat, y) => {
  const at = beat.t, text = clean(beat.text);
  const base = { at, shown: true, x: W / 2, scaleKeys: STAGE_SCALE, posW: 14 };
  const stat = beat.kind === 'stat' ? parseStat(text) : null;
  if (stat) {
    const n = stat.shown.length, uw = stat.unit ? 0.1 + 0.42 * EM * stat.unit.length : 0;
    const sw = stat.suffix ? EM : 0;
    const size = clamp(Math.floor(880 / (0.62 * n + sw + uw)), 150, 330);
    return [{ ...base, k: 'counter', y, value: stat.value, decimals: stat.decimals, decSep: ',', suffix: stat.suffix, unit: stat.unit, size, countFrom: at, countTo: at + 0.8, color: 'ink' }];
  }
  if (beat.kind === 'stat') {
    const first = text.split(' ')[0];
    const size = fitSize(text, { maxW: 900, maxLines: 3, max: 250, min: 110 });
    return [{ ...base, k: 'text', y, text, size, weight: 800, lh: size * 1.05, maxW: 900, emph: first }];
  }
  if (beat.kind === 'tool') {
    const size = fitSize(text, { maxW: 880, maxLines: 2, max: 230, min: 110 });
    const h = wrapCount(text, size, 880) * size * 1.05;
    const ruleY = y + h / 2 + 34;
    return [
      { ...base, k: 'text', y: y - 10, text, size, weight: 800, lh: size * 1.05, maxW: 880 },
      { k: 'line', at: at + 0.12, shown: true, x: W / 2 - 130, y: ruleY, x2: W / 2 + 130, y2: ruleY, lw: 12, color: 'blue', dur: 0.4 },
    ];
  }
  const size = fitSize(text, { maxW: 900, maxLines: 3, max: 270, min: 110 });
  return [{ ...base, k: 'text', y, text, size, weight: 800, lh: size * 1.05, maxW: 900 }];
};

// Punch-ins fill the gaps between beats: a change at least every 4.6 s, never closer than 4 s to the previous punch, never above 1.12.
export const planPunches = ({ beats, punchIns, words, duration, after = 0 }) => {
  const cands = [...new Set([...(punchIns ?? []), ...(words ?? []).map((w) => +w.start.toFixed(3))])].filter((c) => c >= after).sort((a, b) => a - b);
  const bt = (beats ?? []).map((b) => b.t).sort((a, b) => a - b);
  const out = [];
  let last = after, lastPunch = -99;
  for (let guard = 0; guard < 200; guard++) {
    const next = bt.find((t) => t > last + 0.01);
    if (next !== undefined && next <= last + 4.6) { last = next; continue; }
    const from = Math.max(last + 3.2, lastPunch + 4.0);
    const ok = (c) => next === undefined || next - c > 0.9;
    const pick = cands.find((c) => c >= from && c <= last + 4.6 && ok(c)) ?? cands.find((c) => c >= from && ok(c));
    if (pick === undefined || pick > duration - 1.2) { if (next === undefined) break; last = next; continue; }
    out.push(pick); last = pick; lastPunch = pick;
  }
  return out;
};

// The take can open as a screen share with a small webcam bubble (face under 15 % of the frame) and then become a full talking head
// (the bubble grows). `lead` = how long the leading small-face run lasts: 0 = a talking head all along, `duration` = a screen share all along.
export const analyse = (ctx) => {
  const thr = 0.15 * ctx.take.h, smp = [...ctx.face.samples].sort((a, b) => a.t - b.t);
  if (!ctx.face.detected || !smp.length) return { mode: 'screen', lead: ctx.duration, big: null, have: false };
  const firstBig = smp.find((s) => s.h >= thr);
  const lead = firstBig ? firstBig.t : ctx.duration;
  const med = (list, k) => { const v = list.map((s) => s[k]).sort((a, b) => a - b); return v[v.length >> 1]; };
  const bigS = smp.filter((s) => s.t >= lead && s.h >= thr), smallS = smp.filter((s) => s.t < lead);
  const mode = lead < 1.5 ? 'talk' : lead >= ctx.duration * 0.9 ? 'screen' : 'mixed';
  const big = bigS.length ? { cx: med(bigS, 'cx'), cy: med(bigS, 'cy'), h: med(bigS, 'h') } : null;
  const small = smallS.length ? { cx: med(smallS, 'cx'), cy: med(smallS, 'cy'), h: med(smallS, 'h') } : null;
  return { mode, lead, big, small, have: true };
};

const SCREEN_AR = 0.5177;                  // 1080 x 559: the 16:9 screen with 4 % trimmed top and bottom (cover crop of the actor card)
const BEAT_HOLD = 2.8, HOOK_HOLD = 2.2;    // over a screen (screen share all along), a beat or the hook shows this long, then the screen returns
const BEAT_MAX = 6;                        // otherwise a beat holds at most this long, then the hook comes back (a change at least every 6 s)
const LEAD_Y = 510, LEAD_SCREEN_Y = 800, LEAD_CAP_Y = 1450;   // mixed take, screen part: text on top, screen below, no camera card

const spec = (ctx) => {
  const an = analyse(ctx);
  const beats = [...ctx.beats].sort((a, b) => a.t - b.t);
  const overlay = an.mode === 'screen';                                                // screen under the stage, beats laid over it
  const E = an.mode === 'talk' ? 0 : overlay ? Infinity : an.lead;                     // [0, E) = the take shows a screen
  const stacked = an.mode === 'mixed';
  const yOf = (t) => (stacked && t < E ? LEAD_Y : STAGE_Y);
  const cw = ctx.take.w, ch = ctx.take.h;

  // ---- stage windows (take seconds): hook first, then one beat at a time
  const hookMake = (at, y) => hookItem(ctx, at, y);
  const events = [{ t: 0, make: hookMake }, ...beats.map((b) => ({ t: b.t, make: (at, y) => beatItems({ ...b, t: at }, y) }))];
  let wins = [];
  events.forEach((ev, i) => {
    const nextT = i + 1 < events.length ? events[i + 1].t : Infinity;
    const hold = overlay ? (i === 0 ? HOOK_HOLD : BEAT_HOLD) : (i === 0 ? Infinity : BEAT_MAX);
    const to = Math.min(nextT, ev.t + hold);
    wins.push({ from: ev.t, to, make: ev.make });
    if (!overlay && to < nextT) wins.push({ from: to, to: nextT, make: hookMake });
  });
  if (stacked) {   // the stage moves when the screen part ends: re-land whatever is current at E
    wins = wins.flatMap((w) => (w.from < E && w.to > E ? [{ ...w, to: E }, { ...w, from: E }] : [w]));
  }
  const scenes = wins.filter((w) => w.to > w.from).map((w) => {
    const at = w.from, y = yOf(at);
    // screen share all along: the window carries an opaque panel (same colour as the stage) that hides the screen under it
    const cover = overlay ? [{ k: 'card', at, shown: true, still: true, x: W / 2 - 620, y: STAGE_Y + 20 - 360, w: 1240, h: 720, r: 0, elev: 0 }] : [];
    return { type: 'board', from: w.from, ...(w.to !== Infinity ? { to: w.to } : {}), hard: true, gate: false, push: overlay ? 0 : 0.03, pushAt: [W / 2, y], items: [...cover, ...w.make(at, y)] };
  });

  // ---- camera card
  let crop = [0, 0, cw, ch], eyes = ctx.face.eyes, splitZoom = 1.25, grade = true;
  const framing = an.mode === 'screen' ? an.small ?? null : an.big;
  if (an.mode === 'screen' && an.have && framing) {
    // tight webcam crop, same aspect as the card: any wider and the shared screen around the bubble leaks in
    const pw = Math.min(cw, Math.round(framing.h * 2.4 * W / CARD_H)), ph = Math.round(pw * CARD_H / W);
    const x0 = clamp(Math.round(framing.cx - pw / 2), 0, cw - pw), y0 = clamp(Math.round(framing.cy - ph * 0.42), 0, ch - ph);
    crop = [x0, y0, pw, ph]; eyes = [framing.cx - x0, framing.cy - framing.h * 0.22 - y0]; splitZoom = 1;
  } else if (framing) {
    const s0 = Math.max(W / cw, CARD_H / ch);
    eyes = [Math.round(framing.cx), Math.round(framing.cy - framing.h * 0.22)];
    splitZoom = clamp(FACE_PX / (framing.h * s0), 1, 2.6);
  } else if (!an.have) { grade = false; }

  const punchOk = true;
  const punches = punchOk ? planPunches({ beats, punchIns: ctx.punchIns, words: ctx.words, duration: ctx.duration, after: stacked ? E : 0 }) : [];
  const zoomKeys = [[0, 1], ...punches.map((t, i) => [t, i % 2 === 0 ? 1.12 : 1, 400])];
  const layoutKeys = stacked ? [[0, 1920], [E, SEAM, 400]] : [[0, SEAM]];
  const screenY = stacked ? LEAD_SCREEN_Y : 330;
  const actors = E > 0 ? [{ id: 'screen', media: 'screen', from: 0, offset: 0, hard: true, ...(E < Infinity ? { to: E } : {}), keys: [[0, [0, screenY, W]]], ar: SCREEN_AR }] : [];
  return {
    title: clean(ctx.hook) || ctx.creator.name,
    ...(E > 0 ? { media: { screen: { src: 'assets/source.mp4', sync: true, width: 1280 } } } : {}),
    cam: { crop, eyes, splitZoom, wb: grade },
    cut: ctx.cut,
    grade,
    layout: { keys: layoutKeys, frame: { bleed: true, border: 0, r: 0, shadow: 0, m: 0, gap: 0, bottom: 0 } },
    zoom: { keys: zoomKeys, drift: 0.005 },
    scenes,
    actors,
    captions: { ...captions(ctx), ...(stacked ? { paperY: LEAD_CAP_Y } : {}) },
  };
};

const captions = (ctx) => ({
  ...brandCaptions(1100), yKeys: undefined, straddle: true, straddleDy: 64, size: 78,
  replace: ctx.replace, emph: ctx.emph, hide: [],
});

// A flat accent rule on the seam: the one structural line of the layout (only when the seam never moves).
const overlays = (ctx) => {
  const mode = analyse(ctx).mode;
  if (mode === 'mixed') return [];
  return [{ html: `<div style="position:absolute;left:0;top:${SEAM - 3}px;width:${W}px;height:6px;background:${ACCENT}"></div>` }];
};

export default {
  meta: { id: 'split-board', label: 'Split visuel + visage', vertical: false, screenShare: true, contentRect: { x: 0, y: 300, w: 1080, h: 1050 }, description: 'Scène sombre en haut (hook, puis un chiffre ou un mot par beat), visage en bas sous une couture fixe, captions 1 à 3 mots sur la couture.' },
  style: () => ({
    colors: { paper: PAPER, sheet: PAPER, ink: INK, accent: ACCENT, onAccent: ON_ACCENT },
    ...brandStyle(),
    display: { font: brand().font.family, weight: 800, text: brand().font.family, flat: true },
    paper: { bg: 'flat', grain: 0, depth: 0 },
    pace: { speed: 1.05, tighten: { sentence: 0.1, comma: 0.06, word: 0.03, lead: 0.03, tail: 0.3 } },
    music: { mute: true },
    sfx: { mute: true, accents: 0 },
  }),
  spec,
  overlays,
};
