import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './config.ts';
import type { Word } from './transcript.ts';
import type { FaceInfo } from './face.ts';

/** Everything a template may read. Times are TAKE seconds (the engine maps them after silence cuts). */
export interface TemplateCtx {
  hook: string;                         // the on-screen hook, may hold one *accent* word
  question?: string;                    // Q&A: the question being answered
  kicker?: string;
  words: Word[];                        // word-level transcript of the take
  duration: number;                     // take length before the engine tightens it
  emph: string[];                       // words worth emphasis
  replace: [string, string][];          // caption corrections (mishearings, digits)
  cut: [number, number][];              // take ranges to drop (fillers, retakes)
  face: FaceInfo;                       // eyes, face height, drift, in take pixels
  screenShare: boolean;                 // slides or screen with a small webcam: show the whole frame, never zoom on the face
  take: { w: number; h: number };
  broll: { path: string; tags: string[] }[];
  creator: { name: string; lang: string };
  beats: { t: number; text: string; kind: 'stat' | 'label' | 'tool' }[];   // on-screen ideas, in take seconds, each landing on the word that says it
  punchIns: number[];                   // suggested punch-in times: sentence starts, at least 3.5 s apart
}

export interface Overlay { html: string; from?: number; to?: number }  // transparent 1080x1920 page; times in FINAL seconds, omitted = whole clip

export interface Template {
  meta: {
    id: string; label: string; vertical: boolean; cropForVertical?: boolean; description: string;
    screenShare?: boolean;                                     // can present a screen recording itself
    contentRect?: { x: number; y: number; w: number; h: number };   // where footage text may appear on a screen share, so QA ignores it
    assets?: string[];                                         // engine library files the spec uses (e.g. 'sfx/zhhh.mp3'), copied into the project
  };
  style(ctx: TemplateCtx): Record<string, unknown>;
  spec(ctx: TemplateCtx): Record<string, unknown>;
  overlays?(ctx: TemplateCtx): Overlay[];
  images?(ctx: TemplateCtx): { name: string; html: string }[];   // full-frame alpha PNGs the spec draws itself (e.g. words behind the head), as assets/images/<name>.png
}

export const TEMPLATE_DIR = path.join(ROOT, 'templates');

export const listTemplates = () =>
  fs.readdirSync(TEMPLATE_DIR).filter((d) => fs.existsSync(path.join(TEMPLATE_DIR, d, 'template.mjs')));

export async function loadTemplate(id: string): Promise<Template> {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`Invalid template id: ${id}`);
  const file = path.join(TEMPLATE_DIR, id, 'template.mjs');
  if (!fs.existsSync(file)) throw new Error(`Unknown template: ${id}`);
  const mod = await import(`${pathToFileURL(file).href}?v=${fs.statSync(file).mtimeMs}`) as { default: Template };
  return mod.default;
}

export const fontFaces = () => `
@font-face{font-family:'Poppins';font-weight:800;src:url('file://${ROOT}/assets/fonts/Poppins-ExtraBold.ttf')}
@font-face{font-family:'Poppins';font-weight:700;src:url('file://${ROOT}/assets/fonts/Poppins-Bold.ttf')}
@font-face{font-family:'Montserrat';font-weight:100 900;src:url('file://${ROOT}/assets/fonts/Montserrat.ttf')}
`;
