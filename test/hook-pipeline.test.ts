import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('hook pipeline keeps grounded rationales and rejects an attractive but unfaithful headline', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shorts-hook-pipeline-'));
  process.env.SHORTS_DATA = dir;
  const originalPath = process.env.PATH;
  const bin = path.join(dir, 'bin'); fs.mkdirSync(bin);
  process.env.PATH = `${bin}:${originalPath}`;
  const said = 'Mes agents perdaient le contexte de mes calls. Maintenant mes transcriptions leur donnent les vrais problèmes de mes clients.';
  const quote = 'mes transcriptions leur donnent les vrais problèmes de mes clients.';
  const candidates = ['Mes agents comprennent tout sans contexte', 'Tes agents perdent le contexte de tes calls', 'Mes transcriptions nourrissent mes agents tous les matins'].map((text, i) => ({ text, type: 'consequence', viewer_question: 'Comment donner le contexte des vrais problèmes clients aux agents ?', payoff_quote: quote }));
  const grades = candidates.map((_, index) => ({ index, time_to_claim: 4, specificity: 4, open_loop: 4, relevance: 4, complement: 4, payoff: 4, charge: 4, sendable: 4, clarity: 4, icp: 4, faithfulness: index === 0 ? 1 : 4, voice: 4, coherence: 4 }));
  const script = `#!/usr/bin/env node
const fs=require('node:fs');fs.readFileSync(0,'utf8');const args=process.argv;const schema=JSON.parse(args[args.indexOf('--json-schema')+1]);const props=schema.properties||{};
let result;
if(props.hooks)result={hooks:${JSON.stringify(candidates)},emph:['contexte'],replacements:[],shelf_life:'evergreen',beats:[]};
else if(props.scores)result={scores:${JSON.stringify(grades)}};
else if(props.captions)result={captions:['Mes calls servent enfin à quelque chose.'],cold_open:''};
else result={best:0,why:'Test'};
console.log(JSON.stringify({structured_output:result}));`;
  fs.writeFileSync(path.join(bin, 'claude'), script, { mode: 0o700 });
  const { db } = await import('../src/lib/db.ts');
  t.after(() => { db.close(); process.env.PATH = originalPath; fs.rmSync(dir, { recursive: true, force: true }); });
  db.exec("INSERT INTO sources(id,kind) VALUES('src','youtube')");
  db.prepare("INSERT INTO clips(id,source_id,start,end,transcript,title,status) VALUES('clip','src',0,30,?,'Le contexte des agents','candidate')").run(said);
  const { hook } = await import('../src/stages/hook.ts');
  await hook('clip');
  const row = db.prepare("SELECT hook,hooks,status,hook_score FROM clips WHERE id='clip'").get() as {hook: string; hooks: string; status: string; hook_score: number};
  assert.equal(row.hook, candidates[1]!.text);
  assert.equal(row.status, 'hooked'); assert.ok(row.hook_score >= 55);
  const saved = JSON.parse(row.hooks);
  assert.equal(saved.find((h: {text: string}) => h.text === candidates[0]!.text).score, 0);
  assert.equal(saved[0].payoff_quote, quote);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM jobs WHERE type='render' AND ref='clip'").get() as {n: number}).n, 1);
});
