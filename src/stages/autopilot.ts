import fs from 'node:fs';
import path from 'node:path';
import { byPriority, daysToNextIncrease, pickAutoApprovals, pickEvictions, volumeOn, type RankedClip, type VolumeSettings, DEFAULT_CAPTION, channelVolume, type ChannelVolumeRow } from '../lib/autopilot.ts';
import { DATA, ROOT } from '../lib/config.ts';
import { db, getSetting, setSetting } from '../lib/db.ts';
import { freeGb } from '../lib/disk.ts';
import { log } from '../lib/log.ts';
import { getSecret } from '../lib/secrets.ts';
import { freshness } from '../lib/freshness.ts';
import { hookTypeWeights, measuredWeights, viralNote, type OutlierRow } from '../lib/virality.ts';
import { cancelPublication, enabledChannelIds, planAndBook, routesFor, TRYPOST_SECRET } from './publish.ts';

export const AUTOPILOT_DEFAULTS = {
  create_new: '1', text_hook: '1', cold_open: '1', caption_unique: '0',
  caption_text: DEFAULT_CAPTION,
  autopilot: '0', volume_start: '2', volume_step: '0', volume_every_days: '3', volume_max: '40',
  auto_approve_when_empty: '0', auto_approve_min_score: '60', auto_approve_allow_warn: '0',
  post_as_draft: '0', post_start_hour: '9', post_end_hour: '21', post_min_gap_hours: '1',
} as const;

const setting = (k: keyof typeof AUTOPILOT_DEFAULTS) => getSetting(k, AUTOPILOT_DEFAULTS[k]);
const localDate = (d: Date) => d.toLocaleDateString('sv-SE');

export function volumeSettings(now = new Date()): VolumeSettings {
  let startDate = getSetting('volume_start_date', '');
  if (!startDate) { startDate = localDate(now); setSetting('volume_start_date', startDate); }
  return { start: Number(setting('volume_start')), step: Number(setting('volume_step')), everyDays: Number(setting('volume_every_days')), max: Number(setting('volume_max')), startDate };
}

/** Changing the starting volume restarts the growth from today, otherwise it would jump by the days already elapsed. */
export const restartVolumeGrowth = (now = new Date()) => setSetting('volume_start_date', localDate(now));

let ticking = false;
let studyWeights: Record<string, number> | null = null;

function weights(): Record<string, number> {
  if (studyWeights) return studyWeights;
  const f = path.join(DATA, 'research/03-outliers/outliers.json');
  studyWeights = fs.existsSync(f) ? hookTypeWeights(JSON.parse(fs.readFileSync(f, 'utf8')) as OutlierRow[]) : {};
  return studyWeights;
}

/** Gives a clip its note. Once clips are measured, his own results by hook type replace the study's. */
export function rateClip(id: string): void {
  const c = db.prepare('SELECT hook, hook_score, standalone, hook_type, transcript, qa, qa_status FROM clips WHERE id = ?').get(id) as { hook: string | null; hook_score: number | null; standalone: number | null; hook_type: string | null; transcript: string | null; qa: string | null; qa_status: string | null };
  const qa = c.qa ? JSON.parse(c.qa) as { tech?: { duration?: number }; audio?: { tics?: number } } : {};
  const measured = measuredWeights(db.prepare('SELECT c.hook_type type, COUNT(DISTINCT c.id) n, AVG(m.views) views FROM latest_metrics m JOIN clips c ON c.id = m.clip_id WHERE c.hook_type IS NOT NULL GROUP BY c.hook_type').all() as { type: string; n: number; views: number }[]);
  const note = viralNote({
    hookScore: c.hook_score ?? 0, standalone: c.standalone ?? 0, hookType: c.hook_type, text: `${c.hook ?? ''} ${c.transcript ?? ''}`,
    seconds: qa.tech?.duration ?? 30, qaStatus: c.qa_status, tics: qa.audio?.tics ?? 0,
  }, weights(), measured);
  db.prepare('UPDATE clips SET viral = ?, viral_why = ? WHERE id = ?').run(note.score, JSON.stringify(note.why), id);
}

const RANK_COLUMNS = "c.id, c.template, c.viral note, c.approved_by = 'manual' manual, s.path IS NOT NULL uploaded, c.qa_status qa, c.hook, c.transcript, c.shelf_life, s.published_at";
type RankRow = { id: string; template: string | null; note: number | null; manual: number | null; uploaded: number; qa: string | null; hook: string | null; transcript: string | null; shelf_life: string | null; published_at: string | null };
// Judged again on every run: a clip goes stale on the day it would be posted, not the day it was made.
const toRanked = (r: RankRow, now = new Date()): RankedClip & { qa: string | null } => ({ id: r.id, note: r.note ?? 0, manual: Boolean(r.manual), uploaded: Boolean(r.uploaded), qa: r.qa, stale: freshness(`${r.hook ?? ''} ${r.transcript ?? ''}`, r.shelf_life, r.published_at, now).stale });

/** A clip whose format has no destination switched on cannot fill a slot, so it must not count as waiting or be validated. */
const routable = (r: RankRow) => routesFor(r.template, enabledChannelIds()).length > 0;

export const rankedApproved = () => (db.prepare(`SELECT ${RANK_COLUMNS} FROM clips c JOIN sources s ON s.id = c.source_id WHERE c.status = 'approved'`).all() as RankRow[]).filter(routable).map((r) => toRanked(r)).sort(byPriority);

const channelsOn = () => (db.prepare("SELECT COUNT(*) n FROM channels WHERE enabled = 1 AND disabled_upstream = 0").get() as { n: number }).n;

/** Clips a day needs: the general volume, or more when an account grows on its own (YouTube at 10 while Instagram is at 6). */
function dayTarget(v: VolumeSettings, date: Date): number {
  const own = (db.prepare('SELECT max_per_day, vol_start, vol_step, vol_every, vol_since FROM channels WHERE enabled = 1 AND disabled_upstream = 0').all() as unknown as ChannelVolumeRow[])
    .map(channelVolume).filter((x): x is VolumeSettings => x !== null).map((x) => volumeOn(x, date));
  return Math.max(volumeOn(v, date), ...own);
}

function clipsBookedOn(date: Date): number {
  const day = localDate(date);
  const rows = db.prepare("SELECT clip_id, scheduled_at FROM publications WHERE state NOT IN ('cancelled','error')").all() as { clip_id: string; scheduled_at: string }[];
  return new Set(rows.filter((r) => localDate(new Date(r.scheduled_at)) === day).map((r) => r.clip_id)).size;
}

export interface AutopilotRun { approved: number; evicted: number; planned: number; reason?: string }

/** Keeps today and tomorrow filled: hand-validated clips first, then automatic validation for what is left. */
export async function autopilotTick(now = new Date()): Promise<AutopilotRun> {
  // Two runs at once could both evict and rebook: the second one simply waits for the next tick.
  if (ticking) return { approved: 0, evicted: 0, planned: 0, reason: 'déjà en cours' };
  ticking = true;
  try {
    return await runTick(now);
  } finally {
    ticking = false;
  }
}

async function runTick(now: Date): Promise<AutopilotRun> {
  const ctx = { name: 'autopilot.tick' };
  if (setting('autopilot') !== '1') return { approved: 0, evicted: 0, planned: 0, reason: 'pilote automatique coupé' };
  if (!getSecret(TRYPOST_SECRET)) return { approved: 0, evicted: 0, planned: 0, reason: 'TryPost non connecté' };
  if (!channelsOn()) return { approved: 0, evicted: 0, planned: 0, reason: 'aucun compte activé' };

  // Drafts wait for his go. Once draft mode is off, they are removed and booked again as real scheduled posts.
  if (setting('post_as_draft') !== '1') {
    for (const { id } of db.prepare("SELECT id FROM publications WHERE state = 'draft'").all() as { id: string }[]) await cancelPublication(id);
  }

  const v = volumeSettings(now);
  const tomorrow = new Date(now.getTime() + 86_400_000);
  const slots = Math.max(0, dayTarget(v, now) - clipsBookedOn(now)) + Math.max(0, dayTarget(v, tomorrow) - clipsBookedOn(tomorrow));
  let approved = 0;
  if (setting('auto_approve_when_empty') === '1') {
    const reviewable = (db.prepare(`SELECT ${RANK_COLUMNS} FROM clips c JOIN sources s ON s.id = c.source_id WHERE c.status = 'review'`).all() as RankRow[]).filter(routable).map((r) => toRanked(r));
    const ids = pickAutoApprovals({ reviewable, approvedWaiting: rankedApproved().length, slotsToFill: slots, minNote: Number(setting('auto_approve_min_score')), allowWarnings: setting('auto_approve_allow_warn') === '1' });
    const stmt = db.prepare("UPDATE clips SET status = 'approved', approved_by = 'auto', reviewed_at = datetime('now') WHERE id = ?");
    for (const id of ids) stmt.run(id);
    approved = ids.length;
  }

  const booked = (db.prepare(`SELECT p.id pub, p.scheduled_at at, ${RANK_COLUMNS} FROM publications p JOIN clips c ON c.id = p.clip_id JOIN sources s ON s.id = c.source_id WHERE p.state IN ('planned','queued','draft')`).all() as (RankRow & { pub: string; at: string })[])
    .map((r) => ({ ...toRanked(r), pubId: r.pub, at: new Date(r.at) }));
  const evictions = pickEvictions(rankedApproved(), booked, now);
  for (const id of evictions) await cancelPublication(id);

  const planned = planAndBook(now);
  if (approved || evictions.length || planned) log.info({ ...ctx, approved, evicted: evictions.length, planned }, 'Autopilot');
  return { approved, evicted: evictions.length, planned };
}

export function autopilotStatus(now = new Date()) {
  const v = volumeSettings(now);
  const count = (where: string) => (db.prepare(`SELECT COUNT(*) n FROM clips WHERE ${where}`).get() as { n: number }).n;
  const trypost = Boolean(getSecret(TRYPOST_SECRET));
  const channels = channelsOn();
  const on = setting('autopilot') === '1';
  const inDays = (d: number) => volumeOn(v, new Date(now.getTime() + d * 86_400_000));
  return {
    on, trypost, channels, live: on && trypost && channels > 0,
    volumeToday: volumeOn(v, now), volumeIn7: inDays(7), volumeIn30: inDays(30), nextIncreaseIn: daysToNextIncrease(v, now), startDate: v.startDate,
    bookedToday: clipsBookedOn(now),
    waitingManual: count("status = 'approved' AND approved_by = 'manual'"), waitingAuto: count("status = 'approved' AND approved_by = 'auto'"), toReview: count("status = 'review'"),
    freeGb: Math.round(freeGb()),
  };
}
