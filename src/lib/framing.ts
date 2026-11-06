// Is he filling the frame on camera, or is this a screen with a webcam in a corner? The size of the face cannot tell:
// sitting back from an OBS camera, his face is smaller than in a webcam cut-out. Text on screen and the face's position can.
import type { Frame } from './qa-rules.ts';

const MIN_FACE = 0.07;
const SIDE_MARGIN = 0.18;
const MAX_WORDS = 6;
export const FULL_CAMERA_SHARE = 0.7;

export function isCameraFrame(f: Pick<Frame, 'texts' | 'face'>, width: number, height: number): boolean {
  if (!f.face) return false;
  const words = f.texts.reduce((n, t) => n + t.text.trim().split(/\s+/).filter(Boolean).length, 0);
  const cx = (f.face.x + f.face.w / 2) / width;
  return words <= MAX_WORDS && f.face.h / height >= MIN_FACE && cx >= SIDE_MARGIN && cx <= 1 - SIDE_MARGIN;
}

/** Most of the clip must be on camera: cropping a slide into a vertical frame makes it unreadable. */
export function isFullCamera(frames: Pick<Frame, 'texts' | 'face'>[], width: number, height: number): boolean {
  if (!frames.length) return false;
  return frames.filter((f) => isCameraFrame(f, width, height)).length / frames.length >= FULL_CAMERA_SHARE;
}
