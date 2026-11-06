// The rules of the autopilot: how much to post, in what order, what to validate alone, what to bump. Pure, unit tested.

export interface VolumeSettings { start: number; step: number; everyDays: number; max: number; startDate: string }

const dayNumber = (d: Date) => Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86_400_000);
const parseLocal = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y!, m! - 1, d!); };

/** "6 per day today, +1 every 3 days": clips to post on a given date. */
export function volumeOn(v: VolumeSettings, date: Date): number {
  const days = Math.max(0, dayNumber(date) - dayNumber(parseLocal(v.startDate)));
  const steps = v.everyDays > 0 ? Math.floor(days / v.everyDays) : 0;
  return Math.max(0, Math.min(v.max, v.start + steps * v.step));
}

/** Days until the volume next goes up, or null if it no longer will. */
export function daysToNextIncrease(v: VolumeSettings, date: Date): number | null {
  if (v.step <= 0 || v.everyDays <= 0 || volumeOn(v, date) >= v.max) return null;
  const days = Math.max(0, dayNumber(date) - dayNumber(parseLocal(v.startDate)));
  return v.everyDays - (days % v.everyDays);
}

export interface RankedClip { id: string; manual: boolean; uploaded: boolean; note: number; stale?: boolean }

/** Validated by hand and uploaded, then validated by hand, then uploaded, then the rest, then what has aged badly. The note decides within a tier. */
export const tier = (c: Pick<RankedClip, 'manual' | 'uploaded' | 'stale'>) => (c.manual ? (c.uploaded ? 3 : 2) : c.uploaded ? 1 : c.stale ? -1 : 0);
export const priority = (c: RankedClip) => tier(c) * 1000 + c.note;
export const byPriority = <T extends RankedClip>(a: T, b: T) => priority(b) - priority(a);

export interface AutoApproveInput { reviewable: (RankedClip & { qa: string | null })[]; approvedWaiting: number; slotsToFill: number; minNote: number; allowWarnings: boolean }

/**
 * Validation automatique only fills what is left: clips validated by hand always go first, so nothing is
 * validated alone while they are enough to cover the upcoming slots.
 */
export function pickAutoApprovals(i: AutoApproveInput): string[] {
  const missing = i.slotsToFill - i.approvedWaiting;
  if (missing <= 0) return [];
  return i.reviewable
    .filter((c) => c.note >= i.minNote && (c.qa === 'pass' || (i.allowWarnings && c.qa === 'warn')))
    .sort(byPriority)
    .slice(0, missing)
    .map((c) => c.id);
}

export interface BookedRanked extends RankedClip { pubId: string; at: Date }

/**
 * A clip takes the earliest slot held by a lower-tier one: an upload bumps an ordinary clip, a fresh clip bumps a stale one.
 * Hand-validated and uploaded clips never lose their slot, and a post about to leave is left alone.
 */
export function pickEvictions(waiting: RankedClip[], booked: BookedRanked[], now: Date, leadMinutes = 30): string[] {
  const earliest = now.getTime() + leadMinutes * 60_000;
  const movable = booked.filter((b) => tier(b) <= 0 && b.at.getTime() >= earliest).sort((a, b) => a.at.getTime() - b.at.getTime());
  const taken = new Set<string>();
  for (const w of [...waiting].sort(byPriority)) {
    const hit = movable.find((b) => !taken.has(b.pubId) && tier(b) < tier(w));
    if (hit) taken.add(hit.pubId);
  }
  return [...taken];
}

/** The description put on every post while "description unique" is on. Written by le créateur, lowercase on purpose. */
export const DEFAULT_CAPTION = "";

export interface ChannelVolumeRow { vol_start: number | null; vol_step: number | null; vol_every: number | null; vol_since: string | null; max_per_day: number }

/** An account with its own growth ("YouTube: 10 a day, +1 every 3 days") ignores the general volume. Null = it follows it. */
export function channelVolume(c: ChannelVolumeRow): VolumeSettings | null {
  if (c.vol_start == null || !c.vol_since) return null;
  return { start: c.vol_start, step: c.vol_step ?? 0, everyDays: c.vol_every ?? 0, max: c.max_per_day, startDate: c.vol_since };
}
