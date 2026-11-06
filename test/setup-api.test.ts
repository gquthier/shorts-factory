import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

test('fresh-install setup persists only the creator profile and rejects cross-site writes', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shorts-setup-api-'));
  const base='http://127.0.0.1:4212';
  const child=spawn(process.execPath,['--no-warnings','src/server.ts'],{env:{...process.env,PORT:'4212',SHORTS_DATA:dir,SHORTS_NO_WORKER:'1',NODE_ENV:'test',SHORTS_SECRET_STORE:'memory'},stdio:'ignore'});
  t.after(async()=>{child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));fs.rmSync(dir,{recursive:true,force:true});});
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/state')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  let response=await fetch(base+'/api/setup');assert.equal(response.status,200);
  const initial=await response.json();assert.equal(initial.data.profile,null);assert.ok(initial.data.services.every((s:{connected:boolean})=>!s.connected));
  const profile={name:'Alex',lang:'fr',niche:'Cuisine',audience:'Débutants',voice:'Direct et clair',examples:'Un plat simple.'};
  const post=(url:string,body:unknown,origin=base)=>fetch(base+url,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post('/api/setup/profile',profile,'https://untrusted.example')).status,403);
  assert.equal((await post('/api/setup/profile',{...profile,name:''})).status,400);
  assert.equal((await post('/api/setup/profile',profile)).status,200);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'creator-profile.json'),'utf8')).name,'Alex');
  assert.equal((await (await fetch(base+'/api/setup')).json()).data.profile.niche,'Cuisine');
  assert.equal((await post('/api/setup/connection',{service:'evil',apiKey:'invalid-key'})).status,400);
  assert.equal((await post('/api/setup/llm',{provider:'unexpected'})).status,400);
  assert.equal((await post('/api/setup/llm',{provider:'anthropic',model:'claude-sonnet-4-6'})).status,400);
  const state=(await (await fetch(base+'/api/state')).json()).data;
  assert.equal(state.setup_complete,true);assert.equal(state.settings.autopilot,'0');assert.equal(state.settings.auto_approve_when_empty,'0');
});
