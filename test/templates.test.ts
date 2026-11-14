import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { listTemplates, loadTemplate, type TemplateCtx } from '../src/lib/templates.ts';
import { ROOT, ENGINE } from '../src/lib/config.ts';

const words='Voici une méthode simple pour préparer votre premier projet sans oublier les étapes importantes'.split(' ').map((text,i)=>({text,start:i*.45,end:(i+1)*.45}));
const ctx={hook:'Une méthode simple pour ton premier projet',question:'Par où commencer ?',words,duration:8,emph:['méthode'],replace:[],cut:[],face:{detected:true,w:1920,h:1080,eyes:[960,350],faceH:400,driftX:0,samples:[]},screenShare:false,take:{w:1920,h:1080},broll:[],creator:{name:'Demo Creator',lang:'fr'},beats:[{t:1,text:'Une méthode',kind:'label'}],punchIns:[4]} as unknown as TemplateCtx;
test('all seven formats are portable, ship their assets and have executable skill instructions', async()=>{
  const ids=listTemplates();assert.equal(ids.length,7);
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

test('proof-stack opens the stage on proofs, keeps key ideas on the chest and reads captures from the proof folder', async()=>{
  const os=await import('node:os');
  const { proofImages }=await import('../src/lib/proof.ts');
  const { plan, parseStat, labelOf }=await import('../templates/proof-stack/template.mjs') as any;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shorts-proof-'));
  try{
    assert.deepEqual(proofImages(path.join(dir,'missing')),[]);
    for(const f of ['tarifs-page-abonnement.png','notes.txt','methode.JPG'])fs.writeFileSync(path.join(dir,f),'');
    const images=proofImages(dir);
    assert.deepEqual(images.map((i)=>i.tags),[['methode'],['tarifs','page','abonnement']]);
    assert.equal(labelOf(images[1]),'Tarifs page abonnement');
    const said='Voici une méthode simple pour préparer votre premier projet sans oublier les étapes importantes et gagner 700 000 euros avec nos tarifs très clairs pour tout le monde ici'.split(' ').map((text,i)=>({text,start:i*.5,end:(i+1)*.5}));
    const input={...ctx,words:said,duration:16,broll:images,beats:[{t:3,text:'Premier projet',kind:'label'},{t:8.5,text:'700 000 € gagnés',kind:'stat'}]} as unknown as TemplateCtx;
    const p=plan(input);
    assert.equal(p.keys.length,1);assert.equal(p.keys[0].text,'Premier projet');
    assert.equal(p.windows.length,1);
    const items=p.windows[0].items;
    assert.deepEqual(items.map((i:any)=>i.kind),['stat','tool']);
    assert.equal(items[1].image.path,images[1].path);                 // "tarifs" is said: its capture comes in on that word
    assert.ok(items[1].t>items[0].t&&Math.abs(items[0].to-items[1].t)<1e-9);   // one proof at a time: the first leaves when the next lands
    assert.ok(!p.windows[0].items.some((i:any)=>i.image?.path===images[0].path));   // "méthode" is said before the opening rule allows anything
    for(const w of p.windows)assert.ok(w.from>=2.6&&w.to<=16);
    assert.deepEqual(parseStat('700 000 € gagnés'),{prefix:'',value:700000,decimals:0,suffix:'\u00a0€',tail:'gagnés',shown:'700 000'});
    assert.equal(parseStat('Une méthode'),null);
    const template=await loadTemplate('proof-stack');
    const spec=template.spec(input) as any;
    assert.deepEqual(spec.layout.keys.map((k:number[])=>k[1]),[0,900,0]);
    assert.deepEqual(spec.captions.hide,[[p.keys[0].t,p.keys[0].to]]);
    assert.deepEqual(template.images!(input).map((i)=>i.name),['glow','p0','k0']);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
