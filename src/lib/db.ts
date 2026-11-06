import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA } from './config.ts';

fs.mkdirSync(DATA, { recursive: true });
export const db = new DatabaseSync(path.join(DATA, 'factory.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 8000;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, url TEXT, title TEXT, path TEXT, duration REAL,
  status TEXT NOT NULL DEFAULT 'queued', rights_confirmed INTEGER NOT NULL DEFAULT 0, error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS clips (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), start REAL NOT NULL, end REAL NOT NULL,
  category TEXT, title TEXT, why TEXT, standalone INTEGER, transcript TEXT, question TEXT,
  hooks TEXT, hook TEXT, hook_type TEXT, hook_score REAL, caption TEXT, emph TEXT, replacements TEXT,
  template TEXT, status TEXT NOT NULL DEFAULT 'candidate', output TEXT, poster TEXT, qc TEXT, error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), reviewed_at TEXT, exported_at TEXT);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, ref TEXT NOT NULL, resource TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0, error TEXT,
  not_before TEXT NOT NULL DEFAULT (datetime('now')), created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT,
  UNIQUE(type, ref));
CREATE TABLE IF NOT EXISTS metrics (
  clip_id TEXT NOT NULL REFERENCES clips(id), account TEXT NOT NULL, platform TEXT NOT NULL, measured_at TEXT NOT NULL,
  views INTEGER, likes INTEGER, comments INTEGER, sends INTEGER, saves INTEGER, avg_watch_s REAL, skip_rate REAL,
  PRIMARY KEY (clip_id, account, platform, measured_at));
CREATE INDEX IF NOT EXISTS jobs_claim ON jobs(status, resource, not_before);
CREATE INDEX IF NOT EXISTS clips_status ON clips(status, hook_score);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, provider TEXT NOT NULL, profile TEXT, picture TEXT,
  enabled INTEGER NOT NULL DEFAULT 0, disabled_upstream INTEGER NOT NULL DEFAULT 0,
  max_per_day INTEGER NOT NULL DEFAULT 2, synced_at TEXT);
CREATE TABLE IF NOT EXISTS publications (
  id TEXT PRIMARY KEY, clip_id TEXT NOT NULL REFERENCES clips(id), channel_id TEXT NOT NULL REFERENCES channels(id),
  state TEXT NOT NULL DEFAULT 'planned', scheduled_at TEXT NOT NULL, remote_id TEXT, release_url TEXT, error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), measured_at TEXT, UNIQUE(clip_id, channel_id));
CREATE TABLE IF NOT EXISTS ideas (
  id TEXT PRIMARY KEY, topic TEXT NOT NULL, angle TEXT, hook_type TEXT, hooks TEXT, script TEXT, proof_needed TEXT,
  inspired_by TEXT, seconds INTEGER, status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS pubs_state ON publications(state, scheduled_at);
`);
const clipColumns = (db.prepare('PRAGMA table_info(clips)').all() as { name: string }[]).map((c) => c.name);
for (const [name, type] of [['before_redo', 'TEXT'], ['text_hook', 'INTEGER'], ['cold_open', 'TEXT'], ['value_score', 'INTEGER'], ['takeaway', 'TEXT'], ['reworked_at', 'TEXT'], ['qa', 'TEXT'], ['qa_status', 'TEXT'], ['beats', 'TEXT'], ['cuts', 'TEXT'], ['viral', 'INTEGER'], ['viral_why', 'TEXT'], ['approved_by', 'TEXT'], ['shelf_life', 'TEXT']] as const) {
  if (!clipColumns.includes(name)) db.exec(`ALTER TABLE clips ADD COLUMN ${name} ${type}`);
}

if (!(db.prepare('PRAGMA table_info(sources)').all() as { name: string }[]).some((c) => c.name === 'published_at')) db.exec('ALTER TABLE sources ADD COLUMN published_at TEXT');
if (!(db.prepare('PRAGMA table_info(jobs)').all() as { name: string }[]).some((c) => c.name === 'priority')) db.exec('ALTER TABLE jobs ADD COLUMN priority INTEGER NOT NULL DEFAULT 0');

const channelColumns = (db.prepare('PRAGMA table_info(channels)').all() as { name: string }[]).map((c) => c.name);
for (const [name, type] of [['vol_start', 'INTEGER'], ['vol_step', 'INTEGER'], ['vol_every', 'INTEGER'], ['vol_since', 'TEXT']]) {
  if (!channelColumns.includes(name)) db.exec(`ALTER TABLE channels ADD COLUMN ${name} ${type}`);
}

if ((db.prepare('PRAGMA table_info(publications)').all() as { name: string }[]).some((c) => c.name === 'postiz_id')) db.exec('ALTER TABLE publications RENAME COLUMN postiz_id TO remote_id');

export const getSetting = (key: string, fallback: string) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? fallback;
export const setSetting = (key: string, value: string) => { db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value); };

// Additive performance migration; old snapshots remain intact.
for (const [table, name, type] of [
  ['metrics', 'channel_id', 'TEXT'], ['metrics', 'impressions', 'INTEGER'], ['metrics', 'reach', 'INTEGER'],
  ['clips', 'performance_topic', 'TEXT'], ['publications', 'published_at', 'TEXT'],
]) {
  if (!(db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(c => c.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
}
// The former primary key used the display name; names collide and can change.
if (!(db.prepare('PRAGMA table_info(metrics)').all() as { name: string }[]).some(c => c.name === 'metric_id')) {
  db.exec(`BEGIN IMMEDIATE;
    DROP VIEW IF EXISTS latest_metrics;
    CREATE TABLE metrics_identity (
      metric_id INTEGER PRIMARY KEY, clip_id TEXT NOT NULL REFERENCES clips(id), account TEXT NOT NULL,
      platform TEXT NOT NULL, measured_at TEXT NOT NULL, views INTEGER, likes INTEGER, comments INTEGER,
      sends INTEGER, saves INTEGER, avg_watch_s REAL, skip_rate REAL, channel_id TEXT, impressions INTEGER, reach INTEGER);
    INSERT INTO metrics_identity (clip_id,account,platform,measured_at,views,likes,comments,sends,saves,avg_watch_s,skip_rate,channel_id,impressions,reach)
      SELECT clip_id,account,platform,measured_at,views,likes,comments,sends,saves,avg_watch_s,skip_rate,channel_id,impressions,reach FROM metrics;
    DROP TABLE metrics;
    ALTER TABLE metrics_identity RENAME TO metrics;
    CREATE UNIQUE INDEX metrics_snapshot ON metrics(clip_id, COALESCE(channel_id, 'legacy:' || account), platform, measured_at);
    COMMIT;`);
}
db.exec(`
UPDATE metrics SET channel_id = (SELECT id FROM channels WHERE name = metrics.account AND provider = metrics.platform)
 WHERE channel_id IS NULL AND (SELECT COUNT(*) FROM channels WHERE name = metrics.account AND provider = metrics.platform) = 1;
CREATE VIEW IF NOT EXISTS latest_metrics AS
 SELECT * FROM (SELECT m.*, ROW_NUMBER() OVER (
   PARTITION BY clip_id, COALESCE(channel_id, 'legacy:' || account), platform
   ORDER BY julianday(measured_at) DESC, rowid DESC) snapshot_rank FROM metrics m) WHERE snapshot_rank = 1;
CREATE TABLE IF NOT EXISTS idea_briefs (job_ref TEXT PRIMARY KEY, content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
`);
