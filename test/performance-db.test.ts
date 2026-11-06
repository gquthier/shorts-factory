import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('latest snapshots count once, channel names can change, and unknown metrics remain visible', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shorts-stats-'));
  process.env.SHORTS_DATA = dir;
  const { db } = await import('../src/lib/db.ts');
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const { readPerformance } = await import('../src/lib/performance-db.ts');
  db.exec(`INSERT INTO sources (id,kind) VALUES ('src','youtube');
    INSERT INTO clips (id,source_id,start,end,title,category,template) VALUES ('a','src',0,30,'Agents IA','methode','black-frame'),('b','src',0,30,'Mon offre','histoire','cinema-talk');
    INSERT INTO channels (id,name,provider) VALUES ('ig','Nouveau nom','instagram'),('yt','Nouveau nom','youtube');
    INSERT INTO publications (id,clip_id,channel_id,state,scheduled_at) VALUES ('p1','a','ig','published','2026-11-01'),('p2','a','yt','published','2026-11-02'),('p3','b','ig','published','2026-11-03');
    INSERT INTO metrics (clip_id,channel_id,account,platform,measured_at,views) VALUES ('a','ig','Ancien nom','instagram','2026-11-02',100),('a','ig','Nouveau nom','instagram','2026-11-04',250),('a','yt','Nouveau nom','youtube','2026-11-03',400);`);
  const s = readPerformance(db, { days: 0 });
  assert.equal(s.count, 3);
  assert.equal(s.totals.views.value, 650);
  assert.equal(s.totals.views.covered, 2);
  assert.equal(s.top.find(r => r.id === 'p3')!.views, null);
  assert.equal(s.top.find(r => r.id === 'p1')!.account, 'Nouveau nom');
  assert.equal(s.top.find(r => r.id === 'p1')!.topic, 'IA & automatisation');
  db.prepare('UPDATE clips SET performance_topic = ? WHERE id = ?').run('Vente & offres', 'a');
  assert.equal(readPerformance(db, { channel: 'yt', days: 0 }).byTopic[0]!.name, 'Vente & offres');
  // Imported metrics remain available without inventing a publication date.
  db.exec("INSERT INTO metrics (clip_id,account,platform,measured_at,impressions) VALUES ('b','Import','tiktok','2026-11-04',900)");
  assert.equal(readPerformance(db, { days: 0 }).count, 4);
  assert.equal(readPerformance(db, { platform: 'tiktok', days: 7 }).count, 0);
  // Two accounts with the same display name must never replace each other's snapshot.
  db.exec(`INSERT INTO channels (id,name,provider) VALUES ('ig2','Nouveau nom','instagram');
    INSERT INTO publications (id,clip_id,channel_id,state,scheduled_at) VALUES ('p4','a','ig2','published','2026-11-01');
    INSERT OR REPLACE INTO metrics (clip_id,channel_id,account,platform,measured_at,views) VALUES ('a','ig2','Nouveau nom','instagram','2026-11-04',700);`);
  assert.equal(readPerformance(db, { channel: 'ig', days: 0 }).totals.views.value, 250);
  assert.equal(readPerformance(db, { channel: 'ig2', days: 0 }).totals.views.value, 700);
});
