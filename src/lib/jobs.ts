import { db } from './db.ts';

export type Resource = 'io' | 'whisper' | 'llm' | 'render';
export const JOB_RESOURCE = { ingest: 'io', transcribe: 'whisper', mine: 'llm', edit: 'llm', hook: 'llm', render: 'render', qa: 'io', publish: 'io', sync: 'io', ideas: 'llm' } as const satisfies Record<string, Resource>;
export type JobType = keyof typeof JOB_RESOURCE;

/** Thrown by a stage to try again later without counting as a failure (e.g. a live still running). */
export class Retry extends Error {
  readonly delaySeconds: number;
  constructor(message: string, delaySeconds: number) { super(message); this.delaySeconds = delaySeconds; }
}

const SOURCE_JOBS = new Set<JobType>(['ingest', 'transcribe', 'mine']);
const CLIP_JOBS = new Set<JobType>(['edit', 'hook', 'render', 'qa']);

/** What he uploads himself overtakes the YouTube backlog at every stage, so it can go out first. */
function priorityOf(type: JobType, ref: string): number {
  const uploaded = SOURCE_JOBS.has(type)
    ? db.prepare('SELECT path IS NOT NULL u FROM sources WHERE id = ?').get(ref)
    : CLIP_JOBS.has(type) ? db.prepare('SELECT s.path IS NOT NULL u FROM clips c JOIN sources s ON s.id = c.source_id WHERE c.id = ?').get(ref) : null;
  if (type === 'publish') return 20;
  return (uploaded as { u: number } | undefined)?.u ? 10 : 0;
}

export function enqueue(type: JobType, ref: string, priority?: number): void {
  const p = priority ?? priorityOf(type, ref);
  db.prepare(`INSERT INTO jobs (type, ref, resource, priority) VALUES (?, ?, ?, ?)
    ON CONFLICT(type, ref) DO UPDATE SET status = 'queued', attempts = 0, error = NULL, not_before = datetime('now'), priority = excluded.priority`)
    .run(type, ref, JOB_RESOURCE[type], p);
}
