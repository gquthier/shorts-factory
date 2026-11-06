import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

// A real API and generation stage, with an inert worker and a local fake model.
test('performance filters, topic correction and frozen evidence reach the ideas prompt', { timeout: 20000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shorts-performance-api-'));
  const env = { ...process.env, SHORTS_DATA: dir, PORT: '4202', SHORTS_NO_WORKER: '1', SHORTS_TRYPOST_SERVICE: 'SHORTS_TEST_NO_SECRET' };
  const child = spawn(process.execPath, ['--no-warnings', 'src/server.ts'], { env, stdio: 'ignore' });
  let db: DatabaseSync | undefined;
  t.after(async () => { child.kill(); await new Promise(r => child.once('exit', r)); db?.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:4202';
  for (let i = 0; i < 80; i++) { if (await fetch(`${base}/api/performance`).then(r => r.ok).catch(() => false)) break; await new Promise(r => setTimeout(r, 100)); }
  db = new DatabaseSync(path.join(dir, 'factory.db'));
  db.exec(`INSERT INTO sources (id,kind) VALUES ('src','youtube');
    INSERT INTO clips (id,source_id,start,end,title,hook,category,template) VALUES ('a','src',0,30,'Agents IA','Mon équipe IA','methode','black-frame');
    INSERT INTO channels (id,name,provider) VALUES ('ig','Même nom','instagram'),('yt','Même nom','youtube');
    INSERT INTO publications (id,clip_id,channel_id,state,scheduled_at) VALUES ('p1','a','ig','published',datetime('now','-5 days')),('p2','a','yt','published',datetime('now','-5 days'));
    INSERT INTO metrics (clip_id,channel_id,account,platform,measured_at,views,likes,comments,sends) VALUES ('a','ig','Même nom','instagram',datetime('now'),123,10,2,1),('a','yt','Même nom','youtube',datetime('now'),9999,100,2,1);`);
  const get = async (route: string) => (await (await fetch(base + route)).json()).data;
  const post = async (route: string, body: unknown) => fetch(base + route, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const s = await get('/api/performance?channel=ig&metric=interactions');
  assert.equal(s.count, 1); assert.equal(s.totals.interactions.value, 13);
  assert.equal((await fetch(base + '/api/performance?metric=invalid')).status, 400);
  assert.equal((await post('/api/clips/a', { action: 'topic', topic: 'Vente & offres' })).status, 200);
  assert.equal((await get('/api/performance?channel=ig')).byTopic[0].name, 'Vente & offres');
  assert.equal((await post('/api/clips/a', { action: 'topic', topic: 'unknown' })).status, 400);
  assert.equal((await post('/api/ideas/generate', { count: 10, performance: { channel: 'ig', metric: 'impressions' } })).status, 400);
  assert.equal((await post('/api/ideas/generate', { count: 10, performance: { channel: 'ig', metric: 'views' } })).status, 200);
  const job = db.prepare("SELECT ref FROM jobs WHERE type = 'ideas'").get() as { ref: string };
  const brief = JSON.parse((db.prepare('SELECT content FROM idea_briefs WHERE job_ref = ?').get(job.ref) as {content: string}).content);
  assert.equal(brief.scope.channel, 'ig'); assert.equal(brief.examples[0].value, 123);
  assert.equal(brief.examples.length, 1);
  db.exec("UPDATE metrics SET views=88888 WHERE channel_id='ig'");
  // Stub the model process, not the prompt builder: this exercises the actual generation path.
  const bin = path.join(dir, 'bin'); fs.mkdirSync(bin);
  const capture = path.join(dir, 'prompt.txt');
  fs.writeFileSync(path.join(bin, 'claude'), `#!/usr/bin/env node\nconst fs=require('node:fs');fs.writeFileSync(process.env.SHORTS_TEST_PROMPT,fs.readFileSync(0,'utf8'));console.log(JSON.stringify({structured_output:{ideas:[{topic:'Test',angle:'Test',hook_type:'preuve',hooks:['Test'],script:'Un script de test.',proof_needed:[],inspired_by:[]}]}}));`, { mode: 0o700 });
  execFileSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', `import { ideas } from './src/stages/ideas.ts'; await ideas(${JSON.stringify(job.ref)});`], { env: { ...env, PATH: `${bin}:${process.env.PATH}`, SHORTS_TEST_PROMPT: capture }, stdio: 'pipe', timeout: 10000 });
  const prompt = fs.readFileSync(capture, 'utf8');
  const evidence = prompt.split('<performances_des_publications>')[1]!.split('</performances_des_publications>')[0]!;
  assert.match(evidence, /123/); assert.doesNotMatch(evidence, /88888|9999/);
  assert.match(evidence, /Vente & offres/);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM ideas').get() as {n: number}).n, 1);
});
