import fs from 'node:fs';
import path from 'node:path';
import { DATA } from '../lib/config.ts';
import { db } from '../lib/db.ts';
import { Retry } from '../lib/jobs.ts';
import { parseUploadDate } from '../lib/freshness.ts';
import { probeDuration, run } from '../lib/sh.ts';

export const sourceDir = (id: string) => path.join(DATA, 'sources', id);

// IPv4 forced, generous retries, resumable: a 5G connection hiccup must not lose a long download.
const YT = ['--no-playlist', '--force-ipv4', '--retries', '15', '--fragment-retries', '30', '--socket-timeout', '30', '--continue', '--no-warnings', '--no-progress'];

export async function ingest(id: string): Promise<void> {
  const s = db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as { url: string | null; path: string | null; title: string | null };
  const dir = sourceDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, 'source.mp4');
  const audio = path.join(dir, 'audio.m4a');
  let title = s.title;
  if (fs.existsSync(path.join(dir, 'words.json'))) {
    db.prepare("UPDATE sources SET status = 'ingested' WHERE id = ?").run(id);
    return;
  }
  if (s.url && !fs.existsSync(target) && !fs.existsSync(audio)) {
    const { stdout } = await run('yt-dlp', [...YT, '--skip-download', '--print', '%(live_status)s\t%(upload_date)s\t%(title)s', s.url]);
    const [status, uploaded, fetched] = stdout.trim().split('\t');
    db.prepare('UPDATE sources SET published_at = ? WHERE id = ?').run(parseUploadDate(uploaded), id);
    if (status === 'is_live' || status === 'is_upcoming') throw new Retry(`Live in progress (${status}), waiting for the replay`, 15 * 60);
    title = title ?? fetched ?? null;
    // Audio only: enough to find the moments. Video is fetched later, clip by clip, so a 100-video run fits on disk and on 5G.
    await run('yt-dlp', [...YT, '-f', 'ba[ext=m4a]/ba', '-o', audio, s.url]);
  } else if (s.path && !fs.existsSync(target)) {
    await run('ffmpeg', ['-v', 'error', '-y', '-i', s.path, '-c', 'copy', '-movflags', '+faststart', target]).catch(async () =>
      run('ffmpeg', ['-v', 'error', '-y', '-i', s.path!, '-c:v', 'libx264', '-crf', '17', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '192k', target]));
  }
  if (s.path) db.prepare("UPDATE sources SET published_at = COALESCE(published_at, date('now')) WHERE id = ?").run(id);   // a fresh upload
  const media = fs.existsSync(target) ? target : audio;
  if (!fs.existsSync(media)) throw new Error('Source has neither URL nor file');
  db.prepare("UPDATE sources SET status = 'ingested', duration = ?, title = COALESCE(?, title) WHERE id = ?").run(await probeDuration(media), title, id);
}
