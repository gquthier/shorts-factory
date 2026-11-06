import test from 'node:test';
import assert from 'node:assert/strict';
import { connectService, connectionStatus } from '../src/lib/connections.ts';
import { CreatorProfile, profilePrompt, readProfile, saveProfile } from '../src/lib/profile.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { requestStructured } from '../src/lib/anthropic.ts';
import { z } from 'zod';

const key = 'test-only-not-a-real-credential';
test('connection validates a fixed provider endpoint before saving and never returns the key', async () => {
  const saved = new Map<string,string>();
  const store = { get: (k:string)=>saved.get(k)??null, set: (k:string,v:string)=>{saved.set(k,v);}, delete: (k:string)=>{saved.delete(k);} };
  let requested='';
  const fetcher = async (url: string|URL|Request, init?: RequestInit) => {requested=String(url);assert.equal(new Headers(init?.headers).get('x-api-key'),key);return new Response('{"data":[{"id":"claude-sonnet-4-6"}]}');};
  const result=await connectService('anthropic',key,{store,fetchImpl:fetcher});
  assert.equal(requested,'https://api.anthropic.com/v1/models?limit=100');
  assert.equal(result.connected,true);
  assert.equal(saved.size,1);
  assert.ok(!JSON.stringify(connectionStatus(store)).includes(key));
});
test('rejected provider keys preserve existing credentials and redact the upstream body', async () => {
  let writes=0;
  const store={get:()=>key,set:()=>{writes++;},delete:()=>{}};
  for(const status of [401,403,429,500]) {
    await assert.rejects(connectService('apify','invalid-value',{store,fetchImpl:async()=>new Response('upstream leaks '+key,{status})}),e=>e instanceof Error && !e.message.includes(key));
  }
  assert.equal(writes,0);
  await assert.rejects(connectService('unknown',key,{store}));
  await assert.rejects(connectService('anthropic','',{store}));
});
test('provider verification uses authentication headers, bounded requests and no user-controlled URLs', async () => {
  for (const [service,host,header] of [['elevenlabs','api.elevenlabs.io','xi-api-key'],['apify','api.apify.com','authorization'],['trypost','app.trypost.it','authorization']]) {
    let saved=false;
    const result=await connectService(service!,key,{store:{get:()=>null,set:()=>{saved=true;},delete:()=>{}},fetchImpl:async(url,init)=>{
      assert.equal(new URL(String(url)).hostname,host);assert.ok(new Headers(init?.headers).get(header!));assert.ok(init?.signal);return new Response('{}');
    }});
    assert.equal(result.connected,true);assert.ok(saved);
  }
});
test('creator profiles are bounded, reject invalid languages, and keep examples as data', () => {
  const p=CreatorProfile.parse({name:'Alex',niche:'Cuisine',lang:'fr',audience:'Débutants',voice:'Simple et précis',examples:'Mon premier plat.'});
  assert.match(profilePrompt(p),/Cuisine/);
  assert.match(profilePrompt(p),/Débutants/);
  assert.throws(()=>CreatorProfile.parse({...p,name:''}));
  assert.throws(()=>CreatorProfile.parse({...p,lang:'../../secret'}));
  assert.throws(()=>CreatorProfile.parse({...p,examples:'x'.repeat(20001)}));
});
test('profiles persist atomically in the selected private data directory', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shorts-profile-'));
  try {
    assert.equal(readProfile(dir),null);
    saveProfile(dir,{name:'Alex',niche:'Cuisine'});
    assert.equal(readProfile(dir)!.name,'Alex');
    assert.equal(fs.statSync(path.join(dir,'creator-profile.json')).mode&0o777,0o600);
    assert.throws(()=>saveProfile(dir,{name:'',niche:'Cuisine'}));
    assert.equal(readProfile(dir)!.name,'Alex');
    assert.equal(fs.existsSync(path.join(dir,'creator-profile.json.tmp')),false);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
test('Anthropic structured generation validates tool output and protects upstream errors', async () => {
  const schema=z.object({answer:z.string()});
  const opts={model:'claude-sonnet-4-6',system:'Test',prompt:'Say hello',schema};
  const result=await requestStructured(key,opts,async(_,init)=>{
    const body=JSON.parse(String(init?.body));assert.equal(body.tool_choice.name,'submit_result');assert.equal(body.messages[0].content,'Say hello');
    return new Response(JSON.stringify({content:[{type:'tool_use',name:'submit_result',input:{answer:'Hello'}}]}));
  });
  assert.equal(result.answer,'Hello');
  await assert.rejects(requestStructured(key,opts,async()=>new Response(JSON.stringify({content:[{type:'tool_use',name:'submit_result',input:{answer:42}}]}))));
  await assert.rejects(requestStructured(key,opts,async()=>new Response(key,{status:401})),e=>e instanceof Error&&!e.message.includes(key));
  await assert.rejects(requestStructured(key,opts,async()=>new Response('{"content":[]}')));
});
