import { loadConfig } from './lib/config.ts';
import { db, getSetting } from './lib/db.ts';
import { enqueue, Retry, type JobType, type Resource } from './lib/jobs.ts';
import { log } from './lib/log.ts';
import { edit } from './stages/edit.ts';
import { hook } from './stages/hook.ts';
import { ingest } from './stages/ingest.ts';
import { mine } from './stages/mine.ts';
import { autopilotTick } from './stages/autopilot.ts';
import { ideas } from './stages/ideas.ts';
import { publish, sync } from './stages/publish.ts';
import { qa } from './stages/qa.ts';
import { render } from './stages/render.ts';
import { transcribe } from './stages/transcribe.ts';

const MAX_ATTEMPTS = 3;
const STAGES: Record<JobType, { fn: (ref: string) => Promise<void>; next?: JobType }> = {
  ingest: { fn: ingest, next: 'transcribe' },
  transcribe: { fn: transcribe, next: 'mine' },
  mine: { fn: mine },
  edit: { fn: edit },
  hook: { fn: hook },
  render: { fn: render },
  qa: { fn: qa },
  publish: { fn: publish },
  sync: { fn: sync },
  ideas: { fn: ideas },
};

interface JobRow { id: number; type: JobType; ref: string; attempts: number }

function failEntity(job: JobRow, message: string) {
  if (job.type === 'publish') { db.prepare("UPDATE publications SET state = 'error', error = ? WHERE id = ?").run(message.slice(0, 1000), job.ref); return; }
  if (job.type === 'sync' || job.type === 'ideas') return;
  const table = ['ingest', 'transcribe', 'mine'].includes(job.type) ? 'sources' : 'clips';
  db.prepare(`UPDATE ${table} SET status = 'failed', error = ? WHERE id = ?`).run(message.slice(0, 1000), job.ref);
}

async function execute(job: JobRow): Promise<void> {
  const ctx = { name: `job.${job.type}`, ref: job.ref, attempt: job.attempts };
  try {
    log.info(ctx, 'Job started');
    await STAGES[job.type].fn(job.ref);
    db.prepare("UPDATE jobs SET status = 'done', error = NULL, updated_at = datetime('now') WHERE id = ?").run(job.id);
    const next = STAGES[job.type].next;
    if (next) enqueue(next, job.ref);
    log.info(ctx, 'Job done');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof Retry) {
      db.prepare("UPDATE jobs SET status = 'queued', attempts = attempts - 1, error = ?, not_before = datetime('now', ?) WHERE id = ?").run(message, `+${error.delaySeconds} seconds`, job.id);
      log.info({ ...ctx, delay: error.delaySeconds }, message);
      return;
    }
    log.error({ ...ctx, error: message }, 'Job failed');
    if (job.attempts >= MAX_ATTEMPTS) {
      db.prepare("UPDATE jobs SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?").run(message, job.id);
      failEntity(job, message);
    } else {
      db.prepare("UPDATE jobs SET status = 'queued', error = ?, not_before = datetime('now', ?) WHERE id = ?").run(message, `+${60 * job.attempts} seconds`, job.id);
    }
  }
}

// With creation paused, no new video is downloaded, transcribed or mined, and no new clip starts its edit.
// Clips already in the works finish, and publishing goes on.
const PAUSED_WORK = `type IN ('ingest', 'transcribe', 'mine') OR (type = 'edit' AND ref IN (SELECT id FROM clips WHERE status = 'candidate'))`;

function claim(resource: Resource): JobRow | undefined {
  const paused = getSetting('create_new', '1') === '0';
  return db.prepare(`UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = datetime('now')
    WHERE id = (SELECT id FROM jobs WHERE status = 'queued' AND resource = ? AND not_before <= datetime('now') ${paused ? `AND NOT (${PAUSED_WORK})` : ''} ORDER BY priority DESC, id LIMIT 1)
    RETURNING id, type, ref, attempts`).get(resource) as JobRow | undefined;
}

/** Runs until stopped. Each resource class has its own limit: the render queue never starves transcription. */
export function startWorker(): { stop: () => void; idle: () => boolean } {
  const limits = loadConfig().concurrency;
  const active: Record<Resource, number> = { io: 0, whisper: 0, llm: 0, render: 0 };
  db.exec("UPDATE jobs SET status = 'queued', attempts = MAX(0, attempts - 1) WHERE status = 'running'");   // a crash or reboot resumes where it was, and does not count as a failed attempt
  const tick = () => {
    for (const resource of Object.keys(limits) as Resource[]) {
      while (active[resource] < limits[resource]) {
        const job = claim(resource);
        if (!job) break;
        active[resource] += 1;
        void execute(job).finally(() => { active[resource] -= 1; });
      }
    }
  };
  tick();
  const timer = setInterval(tick, 1000);
  const syncTimer = setInterval(() => enqueue('sync', 'trypost'), 3_600_000);
  const pilot = () => autopilotTick().catch((e: unknown) => log.error({ name: 'autopilot.tick', error: e instanceof Error ? e.message : String(e) }, 'Autopilot failed'));
  const pilotTimer = setInterval(() => { void pilot(); }, 5 * 60_000);
  void pilot();
  return {
    stop: () => { clearInterval(timer); clearInterval(syncTimer); clearInterval(pilotTimer); },
    idle: () => Object.values(active).every((n) => n === 0) && (db.prepare("SELECT COUNT(*) n FROM jobs WHERE status IN ('queued','running')").get() as { n: number }).n === 0,
  };
}
