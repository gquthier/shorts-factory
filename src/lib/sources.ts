import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { DATA, loadConfig, ROOT, SOURCE_KINDS } from './config.ts';
import { db } from './db.ts';
import { enqueue } from './jobs.ts';
import { assignToAccounts } from './selection.ts';
import { run } from './sh.ts';

export const AddSourceSchema = z.object({
  kind: z.enum(SOURCE_KINDS),
  url: z.string().url().refine((u) => /^https?:\/\//.test(u), 'http(s) only').optional(),
  path: z.string().optional(),
  title: z.string().max(300).optional(),
  rightsConfirmed: z.literal(true, { errorMap: () => ({ message: 'Confirme que tu as les droits sur cette vidéo' }) }),
}).refine((v) => Boolean(v.url) !== Boolean(v.path), 'Donne une URL ou un fichier');

export function addSource(input: z.input<typeof AddSourceSchema>): string {
  const s = AddSourceSchema.parse(input);
  const yt = s.url?.match(/(?:v=|youtu\.be\/|live\/|shorts\/)([\w-]{11})/)?.[1];
  const id = yt ? `yt-${yt}` : `${s.kind}-${crypto.randomBytes(4).toString('hex')}`;
  db.prepare(`INSERT INTO sources (id, kind, url, path, title, rights_confirmed) VALUES (?, ?, ?, ?, ?, 1)
    ON CONFLICT(id) DO UPDATE SET status = 'queued', error = NULL`).run(id, s.kind, s.url ?? null, s.path ?? null, s.title ?? null);
  enqueue('ingest', id);
  return id;
}

/** Writes approved clips to out/<date>/<account>/ with their post copy, within each account's daily cap. */
export async function exportApproved(date: string): Promise<{ exported: number; backlog: number; dir: string }> {
  const clips = db.prepare("SELECT id, output, hook, caption, hook_type, hook_score FROM clips WHERE status = 'approved' ORDER BY hook_score DESC").all() as { id: string; output: string; hook: string; caption: string | null; hook_type: string; hook_score: number }[];
  const dir = path.join(DATA, 'exports', date);
  const { assigned, backlog } = assignToAccounts(clips, loadConfig().accounts);
  const lines = ['account,clip,hook,hook_type,score,file'];
  for (const [i, c] of assigned.entries()) {
    const accountDir = path.join(dir, c.account);
    fs.mkdirSync(accountDir, { recursive: true });
    const file = path.join(accountDir, `${String(i + 1).padStart(2, '0')}-${c.id}.mp4`);
    // Light export: Reels recompress anyway, and uploads over 5G should stay small.
    await run('ffmpeg', ['-v', 'error', '-y', '-i', c.output, '-c:v', 'h264_videotoolbox', '-b:v', '7M', '-maxrate', '9M', '-bufsize', '14M', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', file]);
    fs.writeFileSync(file.replace(/\.mp4$/, '.txt'), `${c.caption ?? ''}\n`);
    lines.push([c.account, c.id, JSON.stringify(c.hook), c.hook_type, c.hook_score, path.basename(file)].join(','));
    db.prepare("UPDATE clips SET status = 'exported', exported_at = datetime('now') WHERE id = ?").run(c.id);
  }
  if (assigned.length) fs.writeFileSync(path.join(dir, 'manifest.csv'), `${lines.join('\n')}\n`);
  return { exported: assigned.length, backlog: backlog.length, dir };
}

export const MetricsRowSchema = z.object({
  clip_id: z.string(), account: z.string(), platform: z.string(), measured_at: z.string(),
  channel_id: z.string().optional(), impressions: z.coerce.number().int().nonnegative().nullish(), reach: z.coerce.number().int().nonnegative().nullish(),
  views: z.coerce.number().int().nonnegative().nullish(), likes: z.coerce.number().int().nonnegative().nullish(), comments: z.coerce.number().int().nonnegative().nullish(),
  sends: z.coerce.number().int().nonnegative().nullish(), saves: z.coerce.number().int().nonnegative().nullish(), avg_watch_s: z.coerce.number().nonnegative().nullish(), skip_rate: z.coerce.number().nonnegative().nullish(),
});

export function importMetrics(rows: unknown[]): number {
  const stmt = db.prepare(`INSERT OR REPLACE INTO metrics (clip_id, account, platform, measured_at, views, likes, comments, sends, saves, avg_watch_s, skip_rate, channel_id, impressions, reach) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const parsed = rows.map((r) => MetricsRowSchema.parse(r));
  for (const m of parsed) stmt.run(m.clip_id, m.account, m.platform, m.measured_at, m.views ?? null, m.likes ?? null, m.comments ?? null, m.sends ?? null, m.saves ?? null, m.avg_watch_s ?? null, m.skip_rate ?? null, m.channel_id ?? (db.prepare('SELECT MIN(id) id FROM channels WHERE name = ? AND provider = ? HAVING COUNT(*) = 1').get(m.account, m.platform) as {id: string} | undefined)?.id ?? null, m.impressions ?? null, m.reach ?? null);
  return parsed.length;
}

export const clipDir = (id: string) => path.join(DATA, 'clips', id);
