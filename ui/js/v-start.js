import { h } from './dom.js';
import { store, act, render, toast } from './state.js';
import { get, post, del } from './api.js';
import { btn, badge, loading } from './ui.js';

let info=null, pending=false, form=null;
const keys={};
const descriptions={anthropic:'Repérage des extraits, hooks et scripts. Alternative à Claude CLI.',elevenlabs:'Transcription précise au mot. Optionnel : Whisper reste disponible en local.',trypost:'Connecte tes chaînes et récupère leurs statistiques. Chaque compte reste désactivé au départ.',apify:'Recherche de Reels publics pour ta veille. Collectes payantes, déclenchées séparément.'};
async function refresh(){pending=true;try{info=await get('/api/setup');form??={name:'',lang:'fr',niche:'',audience:'',voice:'',examples:'',...info.profile};}catch(e){toast(e.message,'error');}finally{pending=false;render();}}
const field=(key,label,placeholder,area=false)=>h('label',{class:'start-field'},h('span',null,label),h(area?'textarea':'input',{name:key,'aria-label':label,value:form[key],placeholder,rows:area?3:null,maxLength:key==='examples'?20000:key==='voice'?4000:key==='audience'?2000:key==='niche'?1000:100,oninput:e=>{form[key]=e.target.value;}}));
function service(s){
  const busy=store.busy.has('connect-'+s.id);
  return h('section',{key:s.id,class:'start-service'},
    h('div',{class:'row between'},h('h3',null,s.label),badge(s.connected?'Connecté':'Optionnel',s.connected?'ok':'')),
    h('p',{class:'muted'},descriptions[s.id]),
    s.connected ? h('div',{class:'row'},btn('Déconnecter',{small:true,onclick:async()=>{const result=await act('connect-'+s.id,()=>del('/api/setup/connection/'+s.id));if(result)await refresh();}}))
    : h('form',{onsubmit:async e=>{e.preventDefault();const value=keys[s.id]||'';const result=await act('connect-'+s.id,()=>post('/api/setup/connection',{service:s.id,apiKey:value}),{ok:s.label+' connecté',refresh:false});if(result){keys[s.id]='';await refresh();} }},
      h('label',{class:'sr-only',for:'key-'+s.id},'Clé '+s.label),h('div',{class:'start-key'},
        h('input',{id:'key-'+s.id,type:'password',autoComplete:'off',spellcheck:false,placeholder:'Colle ta clé API','aria-label':'Clé '+s.label,value:keys[s.id]||'',oninput:e=>{keys[s.id]=e.target.value;},minLength:8,maxLength:4000,required:true}),
        h('button',{class:'btn primary',type:'submit',disabled:busy},busy?'Vérification…':'Connecter')),
      h('a',{href:s.console,target:'_blank',rel:'noopener noreferrer',class:'start-console'},'Obtenir ma clé ↗')));
}
export function start(){
  if(!info){if(!pending)void refresh();return h('div',{class:'page'},loading(3));}
  return h('div',{key:'start',class:'page start-page'},
    h('div',{class:'start-hero'},h('span',{class:'start-eyebrow'},'SHORTS FACTORY · PREMIER DÉMARRAGE'),h('h1',null,'Tes vidéos. Ta voix. Ton studio.'),h('p',null,'Connecte tes outils, personnalise ton profil, puis transforme tes vidéos en clips.')),
    h('section',{class:'start-section'},h('div',{class:'start-step'},h('span',null,'01'),h('div',null,h('h2',null,'Connecte tes services'),h('p',{class:'muted'},'La clé est testée puis enregistrée dans le trousseau macOS. Elle ne revient jamais dans l’interface. Les frais des fournisseurs restent à ta charge.'))),
      h('div',{class:'start-services'},info.services.map(service)),
      h('div',{class:'start-model'},h('label',null,'Génération de texte',h('select',{'aria-label':'Génération de texte',value:info.provider,onchange:async e=>{const result=await act('provider',()=>post('/api/setup/llm',{provider:e.target.value}),{ok:'Mode enregistré',refresh:false});if(result)await refresh();}},h('option',{value:'claude-cli'},'Claude CLI — connexion locale'),h('option',{value:'anthropic'},'Anthropic — clé API'))),
        info.provider==='anthropic'?h('form',{class:'row',onsubmit:async e=>{e.preventDefault();await act('model',()=>post('/api/setup/llm',{provider:'anthropic',model:info.model}),{ok:'Modèle enregistré',refresh:false});}},h('input',{'aria-label':'Modèle Anthropic',value:info.model,oninput:e=>{info.model=e.target.value;},required:true}),h('button',{class:'btn',type:'submit'},'Enregistrer')):h('p',{class:'muted'},'Avec Claude CLI, connecte-toi une fois dans le terminal : claude auth login. Aucune clé Anthropic nécessaire.'))),
    h('section',{class:'start-section'},h('div',{class:'start-step'},h('span',null,'02'),h('div',null,h('h2',null,'Donne-lui ta voix'),h('p',{class:'muted'},'Ces informations restent dans ton profil local et accompagnent les demandes envoyées au modèle choisi.'))),
      h('form',{onsubmit:async e=>{e.preventDefault();const result=await act('profile',()=>post('/api/setup/profile',form),{ok:'Ton studio est prêt'});if(result){await refresh();location.hash='#/sources';}}},
        h('div',{class:'start-profile'},field('name','Ton nom','Alex'),field('niche','Ton sujet','Cuisine, sport, design, entrepreneuriat…'),
          h('label',{class:'start-field'},h('span',null,'Langue des contenus'),h('select',{'aria-label':'Langue des contenus',value:form.lang,onchange:e=>{form.lang=e.target.value;}},[['fr','Français'],['en','English'],['es','Español'],['de','Deutsch'],['it','Italiano'],['pt','Português']].map(([v,label])=>h('option',{value:v},label)))),
          field('audience','Ton audience','À qui parles-tu ?'),field('voice','Ta manière de parler','Direct, posé, drôle, technique…',true),field('examples','Exemples de ton écriture','Quelques phrases que tu as vraiment écrites ou prononcées.',true)),
        h('div',{class:'row between'},h('p',{class:'muted'},'Tu peux revenir ici à tout moment.'),h('button',{class:'btn primary',type:'submit',disabled:store.busy.has('profile')},'Enregistrer et ouvrir mon studio')))),
    h('section',{class:'start-section'},h('div',{class:'start-step'},h('span',null,'03'),h('div',null,h('h2',null,'Vérifie ton Mac'),h('p',{class:'muted'},'Le montage tourne sur macOS. La commande npm run setup installe les dépendances du projet ; les outils système manquants sont indiqués ci-dessous.'))),
      h('div',{class:'start-tools'},info.tools.map(t=>h('div',{class:'row between',key:t.name},h('b',null,t.name),t.ready?badge('Disponible','ok'):h('code',null,t.hint)))),
      btn('Vérifier à nouveau',{small:true,onclick:refresh})));
}
