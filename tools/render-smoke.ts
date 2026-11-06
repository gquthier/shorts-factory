// Generated media only. No LLM calls, personal videos, or publication.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../src/lib/sh.ts';
import { renderClip } from '../src/lib/render.ts';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shorts-render-smoke-'));
const source=path.join(dir,'fixture.mp4');
await run('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','testsrc2=size=1280x720:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','5','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-y',source]);
const words='Voici une méthode simple pour préparer votre premier projet'.split(' ').map((text,i)=>({text,start:i*.45,end:(i+1)*.45}));
const out=await renderClip({id:'public-smoke',template:'black-frame',sourcePath:source,sourceWords:words,ranges:[[0,5]],hook:'Prépare ton premier projet',creator:{name:'Demo Creator',lang:'fr'},outDir:path.join(dir,'render'),fresh:true});
console.log(JSON.stringify({directory:dir,result:out}));
