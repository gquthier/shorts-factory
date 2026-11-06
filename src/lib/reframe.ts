import type { FaceSample } from './face.ts';

export interface Shot { from: number; to: number; x: number }

/**
 * A virtual camera operator: holds the frame still, and only re-centres when the face leaves a dead zone.
 * Pure function, so the crop plan can be tested without video.
 */
export function planShots(samples: FaceSample[], o: { cropW: number; srcW: number; dur: number; deadZone?: number; minShot?: number }): Shot[] {
  const dead = o.deadZone ?? o.cropW * 0.16;
  const minShot = o.minShot ?? 1.5;
  const clampX = (cx: number) => Math.round(Math.min(Math.max(0, cx - o.cropW / 2), o.srcW - o.cropW));
  if (!samples.length) return [{ from: 0, to: o.dur, x: clampX(o.srcW / 2) }];
  const shots: Shot[] = [];
  let from = 0;
  let center = samples[0]!.cx;
  samples.forEach((s, i) => {
    const look = samples.slice(i, i + 3).map((x) => x.cx).sort((a, b) => a - b)[1] ?? s.cx;
    if (Math.abs(look - center) > dead && s.t - from >= minShot) {
      shots.push({ from, to: s.t, x: clampX(center) });
      from = s.t;
      center = look;
    }
  });
  shots.push({ from, to: o.dur, x: clampX(center) });
  return shots;
}

/** ffmpeg crop x expression: hard cuts between shots, like a human reframing in the edit. */
export const cropExpr = (shots: Shot[]) =>
  shots.slice(0, -1).reduceRight((tail, s) => `if(lt(t,${s.to.toFixed(3)}),${s.x},${tail})`, String(shots.at(-1)!.x));

const median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1] ?? 0;
const even = (n: number) => Math.round(n / 2) * 2;

/** Vertical frame around the face. Sitting back from the camera, it also zooms in, as far as the source stays sharp enough. */
export function verticalFrame(f: { w: number; h: number; faceH: number; samples: FaceSample[] }, o: { faceShare?: number; minHeight?: number } = {}): { w: number; h: number; y: number } {
  const wanted = f.faceH / (o.faceShare ?? 0.2);
  const h = even(Math.min(f.h, Math.max(wanted, Math.min(o.minHeight ?? 620, f.h))));
  const w = even((h * 9) / 16);
  const cy = f.samples.length ? median(f.samples.map((s) => s.cy)) : f.h / 2;
  return { w, h, y: even(Math.min(f.h - h, Math.max(0, cy - h * 0.36))) };
}
