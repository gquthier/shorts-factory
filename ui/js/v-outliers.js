import { h } from './dom.js';
import { store, render } from './state.js';
import { card, pageHead, empty, loading, badge } from './ui.js';
import { icon } from './icons.js';
import { humanize, num, compact, dur } from './util.js';

const o = () => store.ui.outliers;
const sortBy = (k) => { const s = o(); s.dir = s.sort === k ? -s.dir : -1; s.sort = k; render(); };

function th(k, label) {
  const s = o(); const on = s.sort === k;
  return h('th', { key: k, class: 'r', 'aria-sort': on ? (s.dir < 0 ? 'descending' : 'ascending') : 'none' },
    h('button', { type: 'button', class: `sort ${on ? 'on' : ''}`, onclick: () => sortBy(k) }, label, on ? (s.dir < 0 ? ' ↓' : ' ↑') : ''));
}

export function outliers() {
  const rows = store.outliers;
  if (!rows) return h('div', { key: 'outliers', class: 'page' }, pageHead('Outliers'), loading(4));
  if (!rows.length) return h('div', { key: 'outliers', class: 'page' }, pageHead('Outliers', 'Les reels qui ont explosé dans ta niche.'), card(null, empty('Pas encore d\'étude', 'Cette table se remplit quand l\'étude des reels à fort ratio existe.')));
  const s = o();
  const langs = [...new Set(rows.map((r) => r.language).filter(Boolean))].sort();
  const accounts = [...new Set(rows.map((r) => r.handle).filter(Boolean))].sort();
  const types = [...new Set(rows.map((r) => r.hook_type).filter(Boolean))].sort();
  const list = rows.filter((r) => (!s.lang || r.language === s.lang) && (!s.hook || r.hook_type === s.hook) && (!s.account || r.handle === s.account))
    .sort((a, b) => ((a[s.sort] ?? 0) - (b[s.sort] ?? 0)) * s.dir);
  const sel = (label, val, opts, set) => h('select', { 'aria-label': label, value: val, onchange: (e) => { set(e.target.value); render(); } }, h('option', { key: '', value: '' }, label), opts.map((x) => h('option', { key: x, value: x }, humanize(x))));
  return h('div', { key: 'outliers', class: 'page' }, pageHead('Outliers', `${list.length} reel${list.length > 1 ? 's' : ''} sur ${rows.length}`, [
    sel('Tous les comptes', s.account || '', accounts, (v) => { s.account = v; }),
    sel('Toutes les langues', s.lang, langs, (v) => { s.lang = v; }), sel('Tous les hooks', s.hook, types, (v) => { s.hook = v; })]),
  card(null, list.length ? h('div', { class: 'tablewrap' }, h('table', null,
    h('thead', null, h('tr', null, h('th', null, 'Compte'), h('th', null, 'Hook'), h('th', null, 'Type'), th('ratio', 'Ratio'), th('views', 'Vues'), th('median', 'Médiane'), th('duration', 'Durée'), h('th', null, ''))),
    h('tbody', null, list.map((r) => h('tr', { key: r.shortcode || r.url },
      h('td', null, h('b', null, r.handle ? `@${String(r.handle).replace(/^@/, '')}` : '–'), h('div', { class: 'muted sm' }, (r.language || '').toUpperCase())),
      h('td', { class: 'hook-c' }, r.spoken_hook || r.screen_hook || '–', r.screen_hook && r.spoken_hook ? h('div', { class: 'muted sm' }, `À l'écran : ${r.screen_hook}`) : null,
        r.hypothesis ? h('details', { class: 'sm mt' }, h('summary', { class: 'lnk' }, 'Lecture du hook'), h('p', { class: 'mt' }, r.hypothesis), h('p', { class: 'muted mt' }, r.caveat), r.transferable === false ? badge('Contexte personnel / hors cible', 'mute') : null) : null),
      h('td', null, r.hook_type ? badge(humanize(r.hook_type)) : '–'),
      h('td', { class: 'r tnum' }, h('b', { class: 'ratio' }, `×${Number(r.ratio).toFixed(1).replace('.', ',')}`)),
      h('td', { class: 'r tnum' }, compact(r.views)), h('td', { class: 'r tnum muted' }, compact(r.median)), h('td', { class: 'r tnum muted' }, r.duration ? dur(r.duration) : '–'),
      h('td', { class: 'r' }, r.url ? h('a', { class: 'lnk', href: r.url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Ouvrir le reel' }, icon('link', 14)) : null)))))) : empty('Aucun résultat', 'Change les filtres.')));
}
