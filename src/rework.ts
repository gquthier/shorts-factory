// Applies the new editing rules to clips already made.
// To review: redone from the whole video, so the conclusion and the value check apply. They stay visible until the new version is ready.
// Validated: his content stays. New description and opening line, then a new render only if the format or the opening changes.
//   node --no-warnings src/rework.ts review [limit] | validated [limit] | clip <id>
import fs from 'node:fs';
import path from 'node:path';
import { DATA, loadConfig, ROOT } from './lib/config.ts';
import { writeCopy } from './lib/copy.ts';
import { db } from './lib/db.ts';
import { alignToSource } from './lib/ending.ts';
import { enqueue } from './lib/jobs.ts';
import { log } from './lib/log.ts';
import { sampleFrames } from './lib/vision.ts';
import { isFullCamera } from './lib/framing.ts';
import { probeSize } from './lib/sh.ts';
import { coldOpenRange, tightRange, type Sentence, type Word } from './lib/transcript.ts';
import { withoutTics } from './lib/tics.ts';
import { sourceDir } from './stages/ingest.ts';
import { applyGlossary } from './stages/hook.ts';

const PRIORITY = 5;  // after his uploads, before clips not started yet

interface Row { id: string; source_id: string; status: string; start: number; end: number; title: string; hook: string; transcript: string; template: string; cuts: string | null; takeaway: string | null; caption: string | null }

const rows = (where: string, ...args: string[]) => db.prepare(`SELECT id, source_id, status, start, end, title, hook, transcript, template, cuts, takeaway, caption FROM clips WHERE ${where}`).all(...args) as unknown as Row[];

function backupCaptions(): void {
  const file = path.join(DATA, `captions-before-${new Date().toISOString().slice(0, 10)}.json`);
  if (fs.existsSync(file)) return;
  fs.writeFileSync(file, JSON.stringify(db.prepare('SELECT id, caption, hook, template FROM clips WHERE caption IS NOT NULL').all(), null, 1));
}

/** Back to the whole video: a clip's own times are relative to its section. */
function redo(c: Row): boolean {
  const file = path.join(sourceDir(c.source_id), 'sentences.json');
  if (!fs.existsSync(file)) return false;
  const sentences = JSON.parse(fs.readFileSync(file, 'utf8')) as Sentence[];
  const at = alignToSource(sentences, c.transcript);
  if (!at) return false;
  db.prepare('UPDATE clips SET before_redo = ?, start = ?, end = ?, transcript = ?, cuts = NULL, approved_by = NULL WHERE id = ?').run(
    JSON.stringify({ start: c.start, end: c.end, transcript: c.transcript, cuts: c.cuts }), sentences[at.a]!.start, sentences[at.b]!.end, sentences.slice(at.a, at.b + 1).map((s) => s.text).join(' '), c.id);
  enqueue('edit', c.id, PRIORITY);
  return true;
}

/** Keeps his validation: new description, and a new render only when it brings something. */
async function refresh(c: Row): Promise<string> {
  const cfg = loadConfig();
  const copy = await writeCopy({ transcript: c.transcript, title: c.title, hook: c.hook, takeaway: c.takeaway });
  db.prepare('UPDATE clips SET caption = COALESCE(?, caption), cold_open = ?, reworked_at = CURRENT_TIMESTAMP WHERE id = ?').run(copy.caption ? applyGlossary(copy.caption, cfg.glossary) : null, copy.coldOpen, c.id);
  if (c.status !== 'approved') return 'caption';
  const dir = path.join(DATA, 'clips', c.id);
  const section = path.join(dir, 'section.mp4');
  const wordsFile = path.join(dir, 'words.json');
  if (!fs.existsSync(section) || !fs.existsSync(wordsFile)) return 'caption';
  const words = JSON.parse(fs.readFileSync(wordsFile, 'utf8')) as Word[];
  const cuts = JSON.parse(c.cuts ?? '[]') as [number, number][];
  const hasOpening = copy.coldOpen ? coldOpenRange(withoutTics(words), copy.coldOpen, tightRange(words, c.start, c.end), cuts) !== null : false;
  let toCamera = false;
  if (c.template === 'black-frame') {
    const { w, h } = await probeSize(section);
    toCamera = isFullCamera(await sampleFrames(section), 960, Math.round((960 * h) / w));
  }
  if (!hasOpening && !toCamera) return 'caption';
  const output = path.join(dir, 'final.mp4');
  if (fs.existsSync(output)) fs.copyFileSync(output, path.join(dir, 'final.before.mp4'));
  db.prepare("UPDATE clips SET status = 'hooked' WHERE id = ?").run(c.id);
  enqueue('render', c.id, PRIORITY);
  return toCamera ? 'render: camera' : 'render: opening';
}

async function pool<T>(items: T[], size: number, fn: (x: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (next < items.length) await fn(items[next++]!); }));
}

const [mode, arg] = process.argv.slice(2);
backupCaptions();
if (mode === 'clip') {
  const [c] = rows('id = ?', arg!);
  if (!c) throw new Error('Unknown clip');
  process.stdout.write(`${c.id} ${['approved', 'scheduled'].includes(c.status) ? await refresh(c) : redo(c)}\n`);
} else if (mode === 'review') {
  const list = rows("status = 'review' AND reworked_at IS NULL ORDER BY viral DESC");
  const chosen = arg ? list.slice(0, Number(arg)) : list;
  const done = chosen.filter(redo).length;
  // Clips that cannot be found back keep their edit, and still get a description in his voice.
  const left = chosen.filter((c) => (db.prepare('SELECT 1 FROM jobs WHERE type = ? AND ref = ?').get('edit', c.id) === undefined));
  process.stdout.write(`to redo: ${done}/${chosen.length}, not found back: ${left.length}\n`);
} else if (mode === 'validated') {
  const list = rows("status IN ('approved', 'scheduled') AND reworked_at IS NULL ORDER BY status DESC");
  const chosen = arg ? list.slice(0, Number(arg)) : list;
  const tally: Record<string, number> = {};
  await pool(chosen, 3, async (c) => {
    // He may have reopened it since the list was read.
    if (!['approved', 'scheduled'].includes((db.prepare('SELECT status FROM clips WHERE id = ?').get(c.id) as { status: string }).status)) return;
    try { const r = await refresh(c); tally[r] = (tally[r] ?? 0) + 1; } catch (e) { log.warn({ name: 'rework', clipId: c.id, error: String(e) }, 'Refresh failed'); tally.failed = (tally.failed ?? 0) + 1; }
  });
  process.stdout.write(`${JSON.stringify(tally)}\n`);
} else {
  process.stdout.write(`Usage: rework review|validated [limit] | clip <id> (${ROOT})\n`);
}
