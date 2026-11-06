import { h, markClean } from './dom.js';
import { store, act, toast, render, poll } from './state.js';
import { post, upload } from './api.js';
import { card, pageHead, btn, empty, loading, badge, bar } from './ui.js';
import { icon } from './icons.js';
import { KINDS, SOURCE_STATE, mins, ago, fromSql } from './util.js';

const STEPS = ['ingested', 'transcribed', 'mined'];
const u = () => store.ui.sources;

function needRights() {
  if (u().rights) return true;
  u().rightsErr = true; render();
  toast('Confirme les droits sur cette vidéo.', 'error');
  return false;
}

function addUrl(input) {
  const url = u().url.trim();
  if (!url) { toast('Colle un lien.', 'error'); return; }
  if (!needRights()) return;
  act('addUrl', () => post('/api/sources', { kind: u().kind, url, rightsConfirmed: true }), { ok: 'Source ajoutée, elle part en traitement.' })
    .then((r) => { if (r) { u().url = ''; const i = document.getElementById('src-url'); if (i) { i.value = ''; markClean(i); } } });
}

export function sendFile(file) {
  if (!file) return;
  if (!needRights()) return;
  if (file.type && !file.type.startsWith('video/')) { toast('Ce fichier n\'est pas une vidéo.', 'error'); return; }
  const up = { id: `${Date.now()}-${file.name}`, name: file.name, pct: 0, state: 'up' };
  u().uploads = [up, ...u().uploads].slice(0, 5);
  upload(file, { kind: u().kind }, (p) => { up.pct = p; render(); })
    .then(() => { up.state = 'done'; up.pct = 1; toast('Vidéo reçue, elle part en traitement.', 'ok'); poll(); })
    .catch((e) => { up.state = 'err'; up.error = e.message; toast(e.message, 'error'); })
    .finally(render);
}

function addCard() {
  const s = u();
  const drop = h('div', {
    class: `drop ${s.over ? 'over' : ''}`, tabindex: '0', role: 'button', 'aria-label': 'Choisir ou déposer une vidéo',
    onclick: () => document.getElementById('src-file')?.click(),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); document.getElementById('src-file')?.click(); } },
    ondragover: (e) => { e.preventDefault(); if (!s.over) { s.over = true; render(); } },
    ondragleave: () => { s.over = false; render(); },
    ondrop: (e) => { e.preventDefault(); s.over = false; render(); sendFile(e.dataTransfer.files[0]); },
  }, icon('upload', 20), h('div', null, h('b', null, 'Glisse une vidéo ici'), h('span', { class: 'muted' }, ' ou clique pour choisir')),
  h('input', { id: 'src-file', type: 'file', accept: 'video/*', hidden: true, onchange: (e) => { sendFile(e.target.files[0]); e.target.value = ''; } }));

  return card('Nouvelle source', h('div', { class: 'stack' },
    h('div', { class: 'row nowrap' },
      h('select', { 'aria-label': 'Type de source', value: s.kind, onchange: (e) => { s.kind = e.target.value; render(); } }, Object.entries(KINDS).map(([k, v]) => h('option', { key: k, value: k }, v))),
      h('input', { id: 'src-url', class: 'grow', type: 'url', placeholder: 'Lien YouTube ou live', 'aria-label': 'Lien', value: s.url, oninput: (e) => { s.url = e.target.value; }, onkeydown: (e) => { if (e.key === 'Enter') addUrl(); } }),
      btn('Lancer', { kind: 'primary', busy: store.busy.has('addUrl'), onclick: () => addUrl() })),
    drop,
    h('label', { class: `check ${s.rightsErr && !s.rights ? 'err' : ''}` },
      h('input', { type: 'checkbox', checked: s.rights, onchange: (e) => { s.rights = e.target.checked; s.rightsErr = false; render(); } }),
      "C'est mon contenu, ou j'ai l'autorisation de le réutiliser"),
    s.uploads.length ? h('ul', { class: 'list' }, s.uploads.map((x) => h('li', { key: x.id, class: 'list-row' },
      h('div', { class: 'grow' }, h('div', { class: 'ellip' }, x.name), x.state === 'up' ? bar(x.pct, 1) : null, x.error ? h('div', { class: 'err-t sm' }, x.error) : null),
      x.state === 'up' ? h('span', { class: 'tnum muted' }, `${Math.round(x.pct * 100)} %`) : badge(x.state === 'done' ? 'Reçue' : 'Échec', x.state === 'done' ? 'ok' : 'bad')))) : null));
}

function steps(src) {
  if (src.status === 'failed') return null;
  const at = STEPS.indexOf(src.status);
  return h('span', { class: 'steps', title: SOURCE_STATE[src.status] }, STEPS.map((s, i) => h('i', { key: s, class: i <= at ? 'on' : '' })));
}

function row(src, d) {
  const n = d.clips.filter((c) => c.source_id === src.id).length;
  const tone = src.status === 'failed' ? 'bad' : src.status === 'mined' ? 'ok' : 'amber';
  return h('tr', { key: src.id },
    h('td', null, h('div', { class: 'ellip w-title', title: src.title || src.id }, src.title || src.id),
      src.error ? h('div', { class: 'err-t sm' }, src.error.slice(0, 220)) : null),
    h('td', { class: 'muted nowrap' }, KINDS[src.kind] || src.kind),
    h('td', { class: 'tnum muted' }, mins(src.duration) || '–'),
    h('td', { class: 'tnum' }, n || '–'),
    h('td', null, h('span', { class: 'row nowrap' }, steps(src), badge(SOURCE_STATE[src.status] || src.status, tone))),
    h('td', { class: 'muted nowrap' }, src.created_at ? ago(fromSql(src.created_at)) : ''));
}

export function sources() {
  const d = store.data;
  const list = !d ? loading(3) : d.sources.length
    ? h('div', { class: 'tablewrap' }, h('table', null, h('thead', null, h('tr', null, ['Titre', 'Type', 'Durée', 'Clips', 'État', 'Ajoutée'].map((t) => h('th', { key: t }, t)))), h('tbody', null, d.sources.map((s) => row(s, d)))))
    : empty('Aucune source', 'Ajoute un lien ou glisse une vidéo : les clips arrivent tout seuls.');
  return h('div', { key: 'sources', class: 'page' }, pageHead('Sources', 'Le carburant de l\'usine.'), addCard(), card(`Toutes les sources${d ? ` · ${d.sources.length}` : ''}`, list, { key: 'list' }));
}
