import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { listTemplates, loadTemplate, type TemplateCtx } from '../src/lib/templates.ts';
import { ROOT, ENGINE } from '../src/lib/config.ts';

const words='Voici une méthode simple pour préparer votre premier projet sans oublier les étapes importantes'.split(' ').map((text,i)=>({text,start:i*.45,end:(i+1)*.45}));
const ctx={hook:'Une méthode simple pour ton premier projet',question:'Par où commencer ?',words,duration:8,emph:['méthode'],replace:[],cut:[],face:{detected:true,w:1920,h:1080,eyes:[960,350],faceH:400,driftX:0,samples:[]},screenShare:false,take:{w:1920,h:1080},broll:[],creator:{name:'Demo Creator',lang:'fr'},beats:[{t:1,text:'Une méthode',kind:'label'}],punchIns:[4]} as unknown as TemplateCtx;
test('all six formats are portable, ship their assets and have executable skill instructions', async()=>{
  const ids=listTemplates();assert.equal(ids.length,6);
  for(const id of ids){
    const template=await loadTemplate(id);assert.equal(template.meta.id,id);
    assert.ok(fs.existsSync(path.join(ROOT,'skills','format-'+id,'SKILL.md')));
    for(const asset of template.meta.assets??[])assert.ok(fs.existsSync(path.join(ENGINE,'../assets',asset)),id+': missing '+asset);
    for(const screenShare of [false,true]){
      const input={...ctx,screenShare};
      const result={style:template.style(input),spec:template.spec(input),overlays:template.overlays?.(input),images:template.images?.(input)};
      assert.ok(result.spec);assert.ok(result.style);
      const serialized=JSON.stringify(result);assert.ok(!serialized.includes('undefined'));assert.ok(!serialized.includes('NaN'));
      for(const m of serialized.matchAll(/file:\/\/([^'"<>\s]+)/g)){
        const f=m[1]!.replace(/\\/g,'');if(/\.(ttf|woff2)$/.test(f))assert.ok(fs.existsSync(f),id+': missing font '+f);
      }
    }
  }
});
