import { h } from './dom.js';
import { store, act, render, toast } from './state.js';
import { post } from './api.js';
import { btn, pageHead, empty, loading, badge } from './ui.js';
import { icon } from './icons.js';
import { humanize, readSeconds, wordCount, dur } from './util.js';

const TABS = [['new', 'Nouvelles'], ['keep', 'Gardées'], ['filmed', 'Tournées'], ['all', 'Toutes']];
const TONE = { new: 'accent', keep: 'blue', filmed: 'ok' };
const LABEL = { new: 'Nouvelle', keep: 'Gardée', filmed: 'Tournée' };
const FLAG = /(\[\s*À VÉRIFIER\s*:[^\]]*\])/gi;

// Script text with every [À VÉRIFIER : ...] marked as a visible flag.
function script(text) {
  return h('div', { class: 'script' }, String(text || '').split(/\n+/).filter(Boolean).map((line, i) =>
    h('p', { key: i }, line.split(FLAG).map((part, j) => (j % 2 ? h('mark', { key: j, class: 'verify' }, part) : part)))));
}

async function copy(idea) {
  try { await navigator.clipboard.writeText(idea.script); toast('Script copié', 'ok'); } catch { toast('Copie impossible', 'error'); }
}

const setStatus = (i, status, ok) => act(`idea:${i.id}`, () => post(`/api/ideas/${i.id}`, { status }), { ok });

function expanded(i) {
  const busy = store.busy.has(`idea:${i.id}`);
  const proofs = i.proof_needed || []; const insp = i.inspired_by || [];
  const sec = (t, ...c) => h('div', { class: 'field' }, h('div', { class: 'field-l' }, t), ...c);
  return h('div', { class: 'idea-x' },
    sec('3 hooks', h('ol', { class: 'hooks-l' }, (i.hooks || []).slice(0, 3).map((x, k) => h('li', { key: k }, typeof x === 'string' ? x : x.text)))),
    sec(`Script · ${wordCount(i.script)} mots · ~${dur(readSeconds(i.script))} à voix haute`, script(i.script)),
    proofs.length ? sec('Preuves à vérifier', h('ul', { class: 'proofs' }, proofs.map((p, k) => h('li', { key: k }, icon('alert', 13), h('span', null, p))))) : null,
    insp.length ? sec('Inspirations', h('ul', { class: 'insp' }, insp.map((u, k) => h('li', { key: k }, /^https?:\/\//.test(u) ? h('a', { class: 'lnk', href: u, target: '_blank', rel: 'noopener noreferrer' }, icon('link', 13), u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)) : u)))) : null,
    h('div', { class: 'row idea-a' },
      btn('Copier le script', { icon: 'copy', onclick: () => copy(i) }),
      btn('Garder', { icon: 'check', disabled: busy || i.status === 'keep', onclick: () => setStatus(i, 'keep', 'Idée gardée') }),
      btn('Tourné', { icon: 'play', disabled: busy || i.status === 'filmed', onclick: () => setStatus(i, 'filmed', 'Marquée comme tournée') }),
      btn('Écarter', { kind: 'danger-ghost', icon: 'x', disabled: busy, onclick: () => setStatus(i, 'dropped', 'Idée écartée') })));
}

function row(i) {
  const open = store.ui.ideas.open.has(i.id);
  const toggleOpen = () => { const s = new Set(store.ui.ideas.open); open ? s.delete(i.id) : s.add(i.id); store.ui.ideas.open = s; render(); };
  return h('li', { key: i.id, class: `idea ${open ? 'open' : ''}` },
    h('button', { type: 'button', class: 'idea-h', 'aria-expanded': open ? 'true' : 'false', onclick: toggleOpen },
      h('span', { class: `chev ${open ? 'down' : ''}` }, icon('chevron', 14)),
      h('span', { class: 'grow' }, h('b', { class: 'idea-t' }, i.topic), h('span', { class: 'muted sm clamp2' }, i.angle)),
      i.hook_type ? badge(humanize(i.hook_type)) : null,
      h('span', { class: 'tnum muted nowrap' }, `~${dur(readSeconds(i.script) || i.seconds)}`),
      badge(LABEL[i.status] || i.status, TONE[i.status] || 'mute')),
    open ? expanded(i) : null);
}

export function ideas() {
  const d = store.data;
  if (!d) return h('div', { key: 'ideas', class: 'page' }, pageHead('Idées'), loading(4));
  const tab = store.ui.ideas.tab || 'new';
  const all = d.ideas.filter((i) => i.status !== 'dropped');
  const n = (k) => (k === 'all' ? all.length : all.filter((i) => i.status === k).length);
  const list = all.filter((i) => tab === 'all' || i.status === tab);
  const gen = d.running.some((r) => r.type === 'ideas') || d.jobs.some((j) => j.type === 'ideas' && ['queued', 'running'].includes(j.status) && j.n);
  return h('div', { key: 'ideas', class: 'page narrow' },
    pageHead('Idées', 'Scripts prêts à tourner, avec les preuves à retrouver.', [
      btn(gen ? 'Écriture en cours…' : 'Générer 10 idées', { kind: 'primary', icon: 'plus', disabled: gen, busy: store.busy.has('gen'), onclick: () => act('gen', () => post('/api/ideas/generate', { count: 10 }), { ok: 'Écriture lancée, les idées arrivent.' }) })]),
    h('div', { class: 'pills mb' }, TABS.map(([k, l]) => h('button', { key: k, type: 'button', class: `pill ${tab === k ? 'on' : ''}`, 'aria-pressed': tab === k ? 'true' : 'false', onclick: () => { store.ui.ideas.tab = k; render(); } }, l, h('b', { class: 'tnum' }, n(k))))),
    list.length ? h('ul', { class: 'ideas' }, list.map(row))
      : empty(tab === 'new' ? 'Aucune nouvelle idée' : 'Rien ici', gen ? 'Les scripts sont en cours d\'écriture.' : 'Clique sur « Générer 10 idées ».'));
}
