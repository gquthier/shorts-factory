import { h, patch } from './dom.js';
import { store, setRenderer, render, poll, loadRouteData, derive, dismiss } from './state.js';
import { icon } from './icons.js';
import { today } from './v-today.js';
import { sources } from './v-sources.js';
import { review, reviewKey } from './v-review.js';
import { calendar } from './v-calendar.js';
import { accounts } from './v-accounts.js';
import { stats } from './v-stats.js';
import { ideas } from './v-ideas.js';
import { outliers } from './v-outliers.js';
import { settings } from './v-settings.js';
import { start } from './v-start.js';

const ROUTES = [
  { id: 'start', label: 'Démarrer', icon: 'settings', view: start },
  { id: 'today', label: "Aujourd'hui", icon: 'today', view: today, count: (v) => v.review + v.qaFailed + v.pubErrors, tone: 'accent' },
  { id: 'sources', label: 'Sources', icon: 'sources', view: sources, count: (v) => v.sourcesActive },
  { id: 'review', label: 'Revue', icon: 'review', view: review, count: (v) => v.review, tone: 'accent' },
  { id: 'calendar', label: 'Calendrier', icon: 'calendar', view: calendar, count: (v) => v.upcoming.length },
  { id: 'accounts', label: 'Comptes', icon: 'accounts', view: accounts, count: (v, d) => d.channels.filter((c) => c.enabled).length },
  { id: 'stats', label: 'Stats', icon: 'stats', view: stats },
  { id: 'ideas', label: 'Idées', icon: 'ideas', view: ideas, count: (v) => v.newIdeas },
  { id: 'outliers', label: 'Outliers', icon: 'outliers', view: outliers, count: () => store.outliers?.length },
  { id: 'settings', label: 'Réglages', icon: 'settings', view: settings },
];

function readRoute() {
  const id = location.hash.replace(/^#\//, '');
  return ROUTES.some((r) => r.id === id) ? id : 'today';
}

function sidebar() {
  const d = store.data; const v = d ? derive(d) : null;
  const items = ROUTES.map((r, i) => {
    const n = v ? r.count?.(v, d) : null;
    return h('a', { key: r.id, href: `#/${r.id}`, class: `nav ${store.route === r.id ? 'on' : ''}`, 'aria-current': store.route === r.id ? 'page' : null, title: `${r.label} (⌘${i + 1})` },
      icon(r.icon, 16), h('span', { class: 'nav-l' }, r.label), n ? h('span', { class: `count tnum ${r.tone || ''}` }, n) : null);
  });
  return [h('div', { key: 'brand', class: 'brand drag' }),
    h('div', { key: 'name', class: 'appname' }, h('b', null, 'Shorts Factory')),
    h('nav', { key: 'nav', 'aria-label': 'Sections' }, items),
    d ? h('div', { key: 'foot', class: 'side-foot' },
      h('div', { class: 'row between sm' }, h('span', { class: 'muted' }, "Aujourd'hui"), h('b', { class: 'tnum' }, `${d.today?.n ?? 0}/${d.target}`)),
      h('div', { class: 'row nowrap sm' }, h('i', { class: `dot ${d.settings.trypost_configured ? 'ok' : 'amber'}` }), h('span', { class: 'muted' }, d.settings.trypost_configured ? 'TryPost connecté' : 'TryPost non connecté'))) : null];
}

function topbar() {
  const r = ROUTES.find((x) => x.id === store.route);
  const run = store.data?.running.length || 0;
  return [h('span', { key: 't', class: 'top-t' }, r.label),
    h('span', { key: 's', class: 'top-s' },
      store.offline ? h('span', { class: 'status bad' }, h('i', { class: 'dot bad' }), 'Serveur injoignable') : null,
      run ? h('span', { class: 'status' }, h('i', { class: 'pulse' }), `${run} en cours`) : null)];
}

function toasts() {
  return store.toasts.map((t) => h('div', { key: t.id, class: `toast ${t.kind}`, role: t.kind === 'error' ? 'alert' : 'status' },
    h('span', { class: 'grow' }, t.text),
    t.action ? h('button', { type: 'button', class: 'toast-a', onclick: () => { t.action.fn(); dismiss(t.id); } }, t.action.label) : null,
    h('button', { type: 'button', class: 'toast-x', 'aria-label': 'Fermer', onclick: () => dismiss(t.id) }, icon('x', 13))));
}

const $ = (id) => document.getElementById(id);
let lastRoute = null;
setRenderer(() => {
  patch($('side'), sidebar());
  patch($('top'), topbar());
  const route = ROUTES.find((r) => r.id === store.route);
  patch($('main'), [store.error && !store.data ? h('div', { key: 'err', class: 'empty' }, h('div', { class: 'empty-t' }, 'Serveur injoignable'), h('div', { class: 'empty-s' }, store.error)) : route.view()]);
  if (lastRoute !== store.route) { $('main').scrollTop = 0; lastRoute = store.route; }
  patch($('toasts'), toasts());
});

function onRoute() {
  store.route = readRoute();
  render();
  loadRouteData(store.route);
}
window.addEventListener('hashchange', onRoute);

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) {
    if (e.metaKey && /^[1-9]$/.test(e.key) && ROUTES[+e.key - 1]) { e.preventDefault(); location.hash = `#/${ROUTES[+e.key - 1].id}`; }
    return;
  }
  const t = e.target; const tag = t.tagName;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || t.isContentEditable) return;
  if (store.route !== 'review') return;
  if (e.key === ' ' && ['BUTTON', 'A', 'VIDEO'].includes(tag)) return;
  if (reviewKey(e)) e.preventDefault();
});

// A dropped file outside the drop zone must never navigate the window away.
for (const ev of ['dragover', 'drop']) document.addEventListener(ev, (e) => { if (!e.target.closest?.('.drop')) e.preventDefault(); });

store.route = readRoute();
render();
loadRouteData(store.route);
poll();
setInterval(poll, 4000);
