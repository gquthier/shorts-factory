// The creator's visual identity, in one place. Every template reads this: changing it here changes all formats.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FONTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/fonts');
const f = (name) => path.join(FONTS_DIR, name);

export const VIOLET = '#9E6EFA';

export const FONTS = {
  'inter-tight': { label: 'Inter Tight', family: 'Inter Tight', src: f('InterTight.ttf'), weight: 800, size: 72, tracking: -0.035, maxChars: 16, hookWeight: 800, hookTracking: '-.035em', hookScale: 1 },
  bricolage: { label: 'Bricolage Grotesque', family: 'Bricolage Grotesque', src: f('BricolageGrotesque.ttf'), weight: 800, size: 72, tracking: -0.04, maxChars: 16, hookWeight: 800, hookTracking: '-.04em', hookScale: 1 },
  'instrument-serif': { label: 'Instrument Serif', family: 'Instrument Serif', src: f('InstrumentSerif-Regular.ttf'), weight: 400, size: 88, tracking: -0.025, maxChars: 16, hookWeight: 400, hookTracking: '-.025em', hookScale: 1.24 },
  anton: { label: 'Anton', family: 'Anton', src: f('Anton-Regular.ttf'), weight: 400, size: 84, tracking: 0, maxChars: 17, upper: true, hookWeight: 400, hookTracking: '0', hookScale: 1.08, hookUpper: true },
};

/** Bricolage Grotesque: the default font for all formats. SHORTS_FONT is only for side-by-side tests. */
export const brand = () => ({ accent: VIOLET, font: FONTS[process.env.SHORTS_FONT] ?? FONTS.bricolage });

/** Engine style keys that load the brand font. */
export const brandStyle = () => { const { font } = brand(); return { font: { family: font.family, src: font.src } }; };

/** Plain white words, flat: no shadow, no block, no highlighted word. Shared defaults; customize for your brand. */
export const brandCaptions = (y, extra = {}) => {
  const { font } = brand();
  return { style: 'band', bg: 'none', shadow: false, font: font.family, weight: font.weight, size: font.size, tracking: font.tracking, upper: Boolean(font.upper), maxWords: 4, maxChars: font.maxChars + 6, color: '#FFFFFF', hi: '#FFFFFF', yKeys: [[0, y]], ...extra };
};

export const brandColors = () => ({ accent: VIOLET, onAccent: '#FFFFFF' });

export const brandFontFace = () => {
  const { font } = brand();
  return `@font-face{font-family:'${font.family}';font-weight:100 900;src:url('file://${font.src}')}`;
};

/** CSS font shorthand for overlays. */
export const brandCss = (size, lineHeight = 1.08) => { const { font } = brand(); return `font:${font.hookWeight} ${size}px/${lineHeight} '${font.family}';letter-spacing:${font.hookTracking}`; };
