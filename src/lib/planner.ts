// Decides which clip goes where and when. Pure, so every rule below is unit tested.

export interface PlanChannel { id: string; provider: string; maxPerDay: number; volumeOn?: (date: Date) => number }   // volumeOn: the account's own growth, instead of the network's share
export interface PlanClip { id: string; score: number; channels?: string[] }   // channels: where this clip's format may go; omitted = everywhere
export interface Booked { clipId: string; channelId: string; at: Date }
export interface Planned { clipId: string; channelId: string; at: Date }

export interface PlanOptions {
  now: Date;
  startHour: number;     // first slot of the day, local time
  endHour: number;       // last slot of the day, local time
  minGapHours: number;   // between two posts on the same channel
  horizonDays: number;
  volumeOn?: (date: Date) => number;   // clips per day per network; omitted = only the channel caps apply
}

const network = (provider: string) => (provider.startsWith('instagram') ? 'instagram' : provider);
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

export const JITTER_MINUTES = 35;

/** A stable pseudo-random value in [-1, 1] for one slot, so a replan does not reshuffle what is already decided. */
function slotNoise(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (((h >>> 0) % 2001) / 1000) - 1;
}

/**
 * The day's posts are spread evenly over the window, then each one moves by up to 35 minutes either way:
 * posting at machine-regular times is the kind of pattern a platform can read as automation.
 */
function nextSlot(channel: PlanChannel, taken: Date[], capacityOn: (date: Date) => number, o: PlanOptions): Date | null {
  const earliest = o.now.getTime() + 20 * 60_000;   // leave TryPost time to take the upload
  const gapMs = o.minGapHours * 3_600_000;
  for (let day = 0; day < o.horizonDays; day++) {
    const base = new Date(o.now);
    base.setDate(base.getDate() + day);
    const capacity = capacityOn(base);
    const onDay = taken.filter((t) => dayKey(t) === dayKey(base));
    if (capacity <= 0 || onDay.length >= capacity) continue;
    const open = new Date(base);
    open.setHours(o.startHour, 0, 0, 0);
    const close = new Date(base);
    close.setHours(o.endHour, 0, 0, 0);
    const spacing = (close.getTime() - open.getTime()) / capacity;
    const centers = Array.from({ length: capacity }, (_, k) => open.getTime() + (k + 0.5) * spacing);
    // Each existing post holds the nearest slot still free.
    const held = new Set<number>();
    for (const t of onDay) {
      let best = -1;
      centers.forEach((c, k) => { if (!held.has(k) && (best < 0 || Math.abs(c - t.getTime()) < Math.abs(centers[best]! - t.getTime()))) best = k; });
      if (best >= 0) held.add(best);
    }
    const clear = (at: number) => at >= earliest && at >= open.getTime() && at <= close.getTime() && !taken.some((t) => Math.abs(t.getTime() - at) < gapMs * 0.999);
    for (const [k, center] of centers.entries()) {
      if (held.has(k)) continue;
      const noise = slotNoise(`${channel.id}|${dayKey(base)}|${k}`);
      const jittered = Math.round((center + noise * JITTER_MINUTES * 60_000) / 60_000) * 60_000;
      const fallback = Math.round(center / 60_000) * 60_000;
      // A slot whose window has started is still used as soon as possible: that is what an urgent clip needs.
      const soonest = center + JITTER_MINUTES * 60_000 >= earliest ? Math.max(jittered, Math.ceil(earliest / 60_000) * 60_000) : null;
      for (const at of [jittered, fallback, soonest]) {
        if (at !== null && clear(at)) return new Date(at);
      }
    }
  }
  return null;
}

/**
 * Best clips first, earliest free slot first. Each clip appears once per network, because posting the
 * same video on two accounts of one network is the duplicate pattern platforms penalise.
 */
export function planPublications(clips: PlanClip[], channels: PlanChannel[], booked: Booked[], o: PlanOptions): Planned[] {
  const taken = new Map(channels.map((c) => [c.id, booked.filter((b) => b.channelId === c.id).map((b) => b.at)]));
  const accounts = (net: string) => channels.filter((c) => network(c.provider) === net).length;
  // The volume is per network: several accounts on one network share it, each within its own cap.
  const capacity = (c: PlanChannel) => (date: Date) => (c.volumeOn ? Math.min(c.maxPerDay, c.volumeOn(date)) : o.volumeOn ? Math.min(c.maxPerDay, Math.ceil(o.volumeOn(date) / accounts(network(c.provider)))) : c.maxPerDay);
  const providerOf = new Map(channels.map((c) => [c.id, c.provider]));
  const usedNetworks = new Map<string, Set<string>>();
  for (const b of booked) {
    const set = usedNetworks.get(b.clipId) ?? new Set<string>();
    usedNetworks.set(b.clipId, set.add(network(providerOf.get(b.channelId) ?? b.channelId)));
  }
  const out: Planned[] = [];
  for (const clip of [...clips].sort((a, b) => b.score - a.score)) {
    const used = usedNetworks.get(clip.id) ?? new Set<string>();
    const candidates = channels.filter((c) => !clip.channels || clip.channels.includes(c.id)).map((c) => ({ c, at: used.has(network(c.provider)) ? null : nextSlot(c, taken.get(c.id)!, capacity(c), o) }));
    for (const net of new Set(channels.map((c) => network(c.provider)))) {
      const best = candidates
        .filter((x): x is { c: PlanChannel; at: Date } => network(x.c.provider) === net && x.at !== null)
        .sort((a, b) => a.at.getTime() - b.at.getTime())[0];
      if (!best) continue;
      out.push({ clipId: clip.id, channelId: best.c.id, at: best.at });
      taken.set(best.c.id, [...taken.get(best.c.id)!, best.at]);
      used.add(net);
    }
    usedNetworks.set(clip.id, used);
  }
  return out;
}
