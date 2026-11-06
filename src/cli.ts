import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { db } from './lib/db.ts';
import { addSource, exportApproved, importMetrics } from './lib/sources.ts';
import { SOURCE_KINDS, type SourceKind } from './lib/config.ts';
import { startWorker } from './worker.ts';

const USAGE = `factory add <url|file> --kind ${SOURCE_KINDS.join('|')} --rights [--title "..."]
factory run            process the queue until it is empty
factory status         counts per stage
factory export [date]  write approved clips to out/<date>/
factory metrics <file.json>  import performance rows`;

const { values, positionals } = parseArgs({ allowPositionals: true, options: { kind: { type: 'string' }, rights: { type: 'boolean' }, title: { type: 'string' } } });
const [cmd, arg] = positionals;
const out = (v: unknown) => process.stdout.write(`${typeof v === 'string' ? v : JSON.stringify(v, null, 2)}\n`);

if (cmd === 'add' && arg) {
  const isUrl = /^https?:\/\//.test(arg);
  out(addSource({ kind: (values.kind ?? 'youtube') as SourceKind, title: values.title, rightsConfirmed: values.rights as true, ...(isUrl ? { url: arg } : { path: fs.realpathSync(arg) }) }));
} else if (cmd === 'run') {
  const w = startWorker();
  const t = setInterval(() => { if (w.idle()) { clearInterval(t); w.stop(); out('queue empty'); process.exit(0); } }, 2000);
} else if (cmd === 'status') {
  out({
    sources: db.prepare('SELECT status, COUNT(*) n FROM sources GROUP BY status').all(),
    clips: db.prepare('SELECT status, COUNT(*) n FROM clips GROUP BY status').all(),
    jobs: db.prepare('SELECT type, status, COUNT(*) n FROM jobs GROUP BY type, status').all(),
    failed: db.prepare("SELECT type, ref, substr(error, 1, 300) error FROM jobs WHERE status = 'failed' LIMIT 10").all(),
  });
} else if (cmd === 'export') {
  out(await exportApproved(arg ?? new Date().toLocaleDateString('sv-SE')));
} else if (cmd === 'metrics' && arg) {
  out({ imported: importMetrics(JSON.parse(fs.readFileSync(arg, 'utf8')) as unknown[]) });
} else {
  out(USAGE);
}
