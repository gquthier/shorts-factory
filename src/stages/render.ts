import fs from 'node:fs';
import path from 'node:path';
import { DATA, loadConfig } from '../lib/config.ts';
import { db, getSetting } from '../lib/db.ts';
import { requireDisk } from '../lib/disk.ts';
import { enqueue } from '../lib/jobs.ts';
import { renderClip } from '../lib/render.ts';
import { withoutTics } from '../lib/tics.ts';
import { coldOpenRange, tightRange, type Word } from '../lib/transcript.ts';
import { sourceDir } from './ingest.ts';

export async function render(id: string): Promise<void> {
  const cfg = loadConfig();
  const c = db.prepare('SELECT * FROM clips WHERE id = ?').get(id) as { source_id: string; start: number; end: number; hook: string; question: string | null; emph: string; replacements: string; template: string; beats: string | null; cold_open: string | null; text_hook: number | null; cuts: string | null };
  const dir = sourceDir(c.source_id);
  const clipWords = path.join(DATA, 'clips', id, 'words.json');
  const sourceWords = JSON.parse(fs.readFileSync(fs.existsSync(clipWords) ? clipWords : path.join(dir, 'words.json'), 'utf8')) as Word[];
  await requireDisk();
  const section = path.join(DATA, 'clips', id, 'section.mp4');
  const range = tightRange(sourceWords, c.start, c.end);
  const cuts = JSON.parse(c.cuts ?? '[]') as [number, number][];
  const cold = c.cold_open && getSetting('cold_open', '1') === '1' ? coldOpenRange(withoutTics(sourceWords), c.cold_open, range, cuts) : null;
  const opening = cold ? cold[1] - cold[0] : 0;
  const showHook = c.text_hook == null ? getSetting('text_hook', '1') === '1' : c.text_hook === 1;
  const res = await renderClip({
    id, template: c.template, sourcePath: fs.existsSync(section) ? section : path.join(dir, 'source.mp4'),
    sourceWords,
    ranges: cold ? [cold, range] : [range],
    extraCuts: cuts.map(([a, b]): [number, number] => [a - range[0] + opening, b - range[0] + opening]),
    beats: JSON.parse(c.beats ?? '[]') as { phrase: string; text: string; kind: 'stat' | 'label' | 'tool' }[],
    hook: showHook ? c.hook : '', question: c.question ?? undefined,
    emph: JSON.parse(c.emph ?? '[]') as string[], replace: JSON.parse(c.replacements ?? '[]') as [string, string][],
    creator: { name: cfg.creator.name, lang: cfg.creator.lang }, outDir: path.join(DATA, 'clips', id), fresh: true,
  });
  db.prepare("UPDATE clips SET status = 'rendered', template = ?, output = ?, poster = ?, qc = ?, error = NULL WHERE id = ?").run(res.template, res.output, res.poster, res.qc, id);
  enqueue('qa', id);
}
