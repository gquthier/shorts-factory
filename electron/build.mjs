// A distributable application: no pointer to the developer's checkout.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { packager } from '@electron/packager';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const stage=fs.mkdtempSync(path.join(os.tmpdir(),'shorts-factory-package-'));
try {
 for(const name of ['src','ui','electron','templates','assets','prompts','tools','vendor','skills','factory.config.json','package.json','package-lock.json','LICENSE','THIRD_PARTY_NOTICES.md'])fs.cpSync(path.join(root,name),path.join(stage,name),{recursive:true,filter:p=>!p.split(path.sep).some(s=>['node_modules','__pycache__','.DS_Store'].includes(s))});
 execFileSync('npm',['ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],{cwd:stage,stdio:'inherit'});
 execFileSync('npm',['ci','--ignore-scripts','--no-audit','--no-fund'],{cwd:path.join(stage,'vendor/video-agent-skills/skills/short-editing/engine'),stdio:'inherit'});
 const electronVersion=JSON.parse(fs.readFileSync(path.join(root,'node_modules/electron/package.json'),'utf8')).version;
 const built=await packager({dir:stage,out:path.join(root,'dist'),name:'Shorts Factory',overwrite:true,platform:'darwin',arch:process.env.BUILD_ARCH||process.arch,electronVersion,appBundleId:'cc.bizos.shorts-factory',appVersion:'0.1.0',asar:false,prune:false});console.log(built.join('\n'));
}finally{fs.rmSync(stage,{recursive:true,force:true});}
