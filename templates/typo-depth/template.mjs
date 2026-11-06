// Depth typography: the opening words, giant, behind the head; then a stack where the key
// word stands huge and violet among small words; slow push, warm dark grade, a calm bed under the voice, a whoosh on the
// first frame and a boom when the opening lands. Camera clips only: on a screen share there is no head to stand behind.
import { brand, brandColors, brandFontFace, brandStyle, VIOLET } from '../brand.mjs';

const MINT = '#66C885';
const DEEP = '#136B2E';
const MOMENT_GAP = 5.5;      // take seconds between two special moments, so it never gets too much
const MOMENT_LEN = 1.5;

const clean = (s) => String(s ?? '').replace(/\*/g, '');
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const HOOK_MAX = 3.8;       // take seconds of giant words at most
const HOOK_WORDS = 9;
const STOP = /[.!?…]$/;

/** The opening words, grouped like the reference: a short word rides with the next one ("JE VAIS", "EST-CE QUE"). */
export function hookChunks(words) {
  const picked = [];
  for (const w of words) {
    if (w.start > HOOK_MAX || picked.length >= HOOK_WORDS) break;
    picked.push(w);
    if (STOP.test(w.text) && picked.length >= 3) break;
  }
  const chunks = [];
  for (const w of picked) {
    const text = w.text.replace(/[.,;:!?…«»"]/g, '').trim();
    if (!text) continue;
    const last = chunks.at(-1);
    if (last && last.open && (last.text + ' ' + text).length <= 12) { last.text += ` ${text}`; last.end = w.end; last.open = false; continue; }
    chunks.push({ t: w.start, end: w.end, text, open: text.length <= 3 });
  }
  return chunks.map(({ t, end, text }) => ({ t, end, text: text.toUpperCase() }));
}

/** Forehead height in the final 1080x1920 frame: the take is the vertical crop, scaled to full bleed. */
const headY = (ctx) => Math.round(Math.min(900, Math.max(420, (ctx.face.eyes[1] / ctx.take.h) * 1920 - 70)));

const NUMBER = /^\d[\d\s.,]*(?:k|K|€|%|x)?$/;
const plainWord = (t) => t.replace(/[.,;:!?…«»"()]/g, '').trim();

const norm = (t) => t.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const inCut = (t, cuts) => cuts.some(([a, b]) => t >= a - 0.05 && t <= b + 0.05);

/** Where a phrase starts in the take, or null. */
function phraseAt(words, phrase) {
  const target = norm(phrase).split(' ').filter(Boolean);
  if (!target.length) return null;
  const tokens = words.map((w) => norm(w.text));
  for (let i = 0; i < tokens.length; i++) {
    if (target.every((t, n) => tokens[i + n] === t)) return words[i].start;
  }
  return null;
}

/** Short enough to stand huge on screen; otherwise its longest word. */
const shortText = (text) => {
  const t = plainWord(text).toUpperCase();
  return t.length <= 14 ? t : t.split(/\s+/).sort((x, y) => y.length - x.length)[0];
};

/**
 * The special moments after the opening, one every MOMENT_GAP s at most: a figure becomes a giant 3D number, a key idea
 * goes huge behind the head or white-on-black in the middle, in turn. Candidates: the on-screen ideas the hook writer
 * found (beats), the emphasised phrases, then any figure said. Take seconds.
 */
export function pickMoments(words, { emph = [], beats = [], cuts = [] } = {}, from, until) {
  const cands = [
    ...beats.map((b) => ({ t: b.t, text: b.text, number: b.kind === 'stat' })),
    ...emph.map((e) => ({ t: phraseAt(words, e), text: e, number: /\d/.test(e) })),
    ...words.filter((w) => /\d/.test(w.text)).map((w) => ({ t: w.start, text: w.text, number: true })),
  ].filter((c) => c.t != null && c.t >= from && c.t <= until - 1 && !inCut(c.t, cuts) && plainWord(c.text))
    .sort((x, y) => x.t - y.t);
  const out = [];
  let behind = true;
  for (const c of cands) {
    if (out.length && c.t - out.at(-1).t < MOMENT_GAP) continue;
    const text = shortText(c.text);
    const number = c.number && text.length <= 7;
    const kind = number ? 'number' : behind ? 'behind' : 'inverted';
    if (!number) behind = !behind;
    out.push({ t: c.t, end: Math.min(until, c.t + MOMENT_LEN), text, kind });
  }
  return out;
}

const fit = (text) => Math.max(120, Math.min(250, Math.floor(980 / Math.max(3, text.length * 0.62))));

// Jump cuts on phrase starts, fewer than cinema-talk: the reference holds its shots.
function punches(words, gap = 4.2) {
  const out = [];
  words.forEach((w, i) => {
    const p = words[i - 1];
    if (i && (/[.!?…]$/.test(p.text) || w.start - p.end > 0.35) && w.start - (out.at(-1) ?? -gap) >= gap && w.start > HOOK_MAX) out.push(+w.start.toFixed(3));
  });
  return out;
}

const font = () => brand().font.family;

/** A word centred on the forehead, so the head covers its middle, as in the reference. */
function behindHtml(ctx, text, color, k = 1) {
  const size = Math.round(fit(text) * k);
  return `<style>${brandFontFace()}.w{position:absolute;left:30px;right:30px;top:${headY(ctx) - size * 0.55}px;text-align:center;color:${color};font:800 ${size}px/1 '${font()}';letter-spacing:-.045em;white-space:nowrap}</style><div class="w">${esc(text)}</div>`;
}

function momentHtml(ctx, m, k) {
  if (m.kind === 'behind') return behindHtml(ctx, m.text, MINT, k);
  if (m.kind === 'inverted') {
    const size = Math.round(Math.min(150, fit(m.text) * 0.75) * k);
    return `<style>${brandFontFace()}.b{position:absolute;left:50%;top:${headY(ctx) + 330}px;transform:translate(-50%,-50%);background:#fff;color:#0a0a0a;padding:${Math.round(size * 0.12)}px ${Math.round(size * 0.28)}px ${Math.round(size * 0.18)}px;font:800 ${size}px/1 '${font()}';letter-spacing:-.04em;white-space:nowrap}</style><div class="b">${esc(m.text)}</div>`;
  }
  // number: deep green with a stacked violet extrusion
  const size = Math.round(Math.min(420, 1500 / Math.max(1, m.text.length)) * k);
  const depth = Array.from({ length: 10 }, (_, i) => `${i + 1}px ${i + 1}px 0 ${VIOLET}`).join(',');
  return `<style>${brandFontFace()}.n{position:absolute;left:0;right:0;top:${headY(ctx) - size * 0.62}px;text-align:center;color:${DEEP};font:800 ${size}px/1 '${font()}';letter-spacing:-.05em;text-shadow:${depth};-webkit-text-stroke:2px ${MINT}}</style><div class="n">${esc(m.text)}</div>`;
}

const hookEndOf = (ctx) => { const c = hookChunks(ctx.words); return c.length ? Math.min(HOOK_MAX + 0.6, c.at(-1).end + 0.25) : 0; };
const momentsOf = (ctx) => pickMoments(ctx.words, { emph: ctx.emph, beats: ctx.beats, cuts: ctx.cut }, hookEndOf(ctx) + 1.5, ctx.duration);

export default {
  meta: {
    id: 'typo-depth', label: 'Typo profondeur', vertical: true,
    description: 'Plein vertical cinéma, premiers mots géants derrière la tête, mot clé violet, musique d\'ambiance, whoosh et boom.',
    assets: ['sfx/zhhh.mp3', 'sfx/impact-boom.mp3'],
  },
  style: () => ({
    colors: { paper: '#000000', ink: '#FFFFFF', ...brandColors() },
    ...brandStyle(),
    paper: { bg: 'flat', grain: 0, depth: 0 },
    pace: { speed: 1.03, tighten: { sentence: 0.12, comma: 0.06, word: 0.03, lead: 0.03, tail: 0.35 } },
  }),
  images: (ctx) => [
    ...hookChunks(ctx.words).map((c, i) => ({ name: `hook-${i}`, html: behindHtml(ctx, c.text, '#FFFFFF') })),
    ...momentsOf(ctx).flatMap((m, i) => [0.86, 1].map((k, step) => ({ name: `m${i}-${step}`, html: momentHtml(ctx, m, k) }))),
  ],
  spec: (ctx) => {
    const chunks = hookChunks(ctx.words);
    const hookEnd = hookEndOf(ctx);
    const moments = momentsOf(ctx);
    const keys = [[0, 1]];
    punches(ctx.words).forEach((t, i) => keys.push([t, i % 2 === 0 ? 1.07 : 1.0, 380]));
    const hits = [{ at: 0.02, src: 'assets/sfx/zhhh.mp3', gain: -15, peak: true }];
    if (chunks.length) hits.push({ at: hookEnd, src: 'assets/sfx/impact-boom.mp3', gain: -13, peak: true });
    for (const m of moments) {
      // a soft whoosh brings each moment in; the number and the inverted word land with a boom
      hits.push({ at: Math.max(0, m.t - 0.12), src: 'assets/sfx/zhhh.mp3', gain: -20, peak: true });
      if (m.kind !== 'behind') hits.push({ at: m.t + 0.05, src: 'assets/sfx/impact-boom.mp3', gain: -17, peak: true });
    }
    // the inverted word and the number also punch the camera in
    for (const m of moments.filter((x) => x.kind !== 'behind')) keys.push([m.t, 1.12, 160], [m.end, 1.0, 300]);
    keys.sort((a, b) => a[0] - b[0]);
    const layers = [
      ...chunks.map((c, i) => ({ at: c.t, kind: 'cam', img: `assets/images/hook-${i}.png`, hard: true })),
      ...(chunks.length ? [{ at: hookEnd, kind: 'cam', hard: true }] : []),
      ...moments.flatMap((m, i) => [
        { at: m.t, kind: 'cam', img: `assets/images/m${i}-0.png`, hard: true },
        { at: m.t + 0.09, kind: 'cam', img: `assets/images/m${i}-1.png`, hard: true },
        { at: m.end, kind: 'cam', hard: true },
      ]),
    ];
    const cutoutEnd = Math.max(hookEnd, ...moments.map((m) => m.end));
    return {
      title: clean(ctx.hook) || ctx.creator.name,
      cam: { crop: [0, 0, ctx.take.w, ctx.take.h], eyes: ctx.face.eyes, wb: true },
      cut: ctx.cut,
      grade: 'eq=contrast=1.08:saturation=0.9:gamma=0.96,vignette=angle=PI/4',
      layout: { keys: [[0, 0]] },
      zoom: { keys, drift: 0.005 },
      cutout: layers.length ? [{ mode: 'cam', from: 0, to: cutoutEnd + 0.05, bg: layers }] : [],
      scenes: [],
      actors: [],
      captions: {
        style: 'stack', upper: true, font: font(), bigFont: font(), bigWeight: 800, weight: 800, size: 62, big: 2.5, stretch: 'normal', smallW: 640,
        color: '#FFFFFF', bigColor: MINT, snap: true, maxWords: 5, fullY: 1490,
        replace: ctx.replace, emph: ctx.emph,
        // no caption while a giant word is on screen: one strong thing at a time
        hide: [...(hookEnd ? [[0, hookEnd]] : []), ...moments.map((m) => [m.t, m.end])],
      },
      music: { bed: 'sonar', offset: 0 },
      mix: { music: -31, sfx: -27, duck: 0.4 },
      sfx: { accents: 0, files: hits },
    };
  },
};
