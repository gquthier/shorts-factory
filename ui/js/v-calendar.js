import { h } from './dom.js';
import { store, act, render, derive } from './state.js';
import { post } from './api.js';
import { btn, iconBtn, pageHead, badge, empty, loading, stateTone } from './ui.js';
import { icon } from './icons.js';
import { schedule } from './v-today.js';
import { PUB_STATE, provider, dayKey, timeOf, startOfWeek, addDays } from './util.js';

const cal = () => store.ui.calendar;
const weekStart = () => cal().weekStart || (cal().weekStart = startOfWeek(new Date()));
const shift = (n) => { cal().weekStart = addDays(weekStart(), n * 7); render(); };

function cancel(p) {
  act(`cancel:${p.id}`, () => post(`/api/publications/${p.id}/cancel`), { ok: 'Publication annulée' });
}

function item(p) {
  const dt = new Date(p.scheduled_at);
  const canCancel = p.state !== 'published';
  return h('li', { key: p.id, class: `pub ${p.state}` },
    h('div', { class: 'pub-top' }, h('b', { class: 'tnum' }, timeOf(dt)), badge(PUB_STATE[p.state] || p.state, stateTone[p.state])),
    h('div', { class: 'pub-hook clamp3', title: p.hook || '' }, p.hook || p.clip_id),
    h('div', { class: 'muted sm ellip' }, `${p.channel || p.channel_id} · ${provider(p.provider)}`),
    p.state === 'error' ? h('div', { class: 'callout bad sm' }, p.error || 'Erreur inconnue') : null,
    h('div', { class: 'pub-a' },
      p.release_url ? h('a', { class: 'lnk', href: p.release_url, target: '_blank', rel: 'noopener noreferrer' }, icon('link', 13), 'Voir le post') : null,
      canCancel ? btn('Annuler', { small: true, kind: 'danger-ghost', busy: store.busy.has(`cancel:${p.id}`), onclick: () => cancel(p) }) : null));
}

export function calendar() {
  const d = store.data;
  if (!d) return h('div', { key: 'calendar', class: 'page' }, pageHead('Calendrier'), loading(4));
  const v = derive(d);
  const ws = weekStart();
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const by = {};
  for (const p of d.publications) (by[dayKey(new Date(p.scheduled_at))] ||= []).push(p);
  const todayK = dayKey(new Date());
  const label = `${days[0].toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} – ${days[6].toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const firstErr = d.publications.filter((p) => p.state === 'error').sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))[0];
  const weekCount = days.reduce((n, x) => n + (by[dayKey(x)]?.length || 0), 0);

  return h('div', { key: 'calendar', class: 'page' },
    pageHead('Calendrier', `${d.publications.length} publication${d.publications.length > 1 ? 's' : ''} au total`, [
      btn(`Programmer les validés${v.approved ? ` · ${v.approved}` : ''}`, { kind: 'primary', icon: 'calendar', disabled: !v.approved, busy: store.busy.has('schedule'), title: v.approved ? '' : 'Aucun clip validé à programmer', onclick: schedule })]),
    v.pubErrors ? h('div', { class: 'strip bad' }, icon('alert', 15), h('span', { class: 'grow' }, `${v.pubErrors} publication${v.pubErrors > 1 ? 's' : ''} en erreur`),
      btn('Voir', { small: true, onclick: () => { cal().weekStart = startOfWeek(new Date(firstErr.scheduled_at)); render(); } })) : null,
    h('div', { class: 'weeknav' },
      iconBtn('left', 'Semaine précédente', () => shift(-1)), h('b', { class: 'weeklabel' }, label), iconBtn('right', 'Semaine suivante', () => shift(1)),
      btn("Aujourd'hui", { small: true, onclick: () => { cal().weekStart = startOfWeek(new Date()); render(); } })),
    h('div', { class: 'week' }, days.map((day) => {
      const k = dayKey(day); const items = (by[k] || []).sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
      return h('section', { key: k, class: `day ${k === todayK ? 'today' : ''}`, 'aria-label': day.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) },
        h('header', { class: 'day-h' }, h('span', { class: 'day-w' }, day.toLocaleDateString('fr-FR', { weekday: 'short' })), h('b', { class: 'day-n tnum' }, day.getDate()), items.length ? h('span', { class: 'day-c tnum' }, items.length) : null),
        items.length ? h('ul', { class: 'pubs' }, items.map(item)) : h('div', { class: 'day-e' }, '–'));
    })),
    !d.publications.length ? empty('Rien de programmé', v.approved ? 'Clique sur « Programmer les validés » pour répartir les clips sur tes comptes.' : 'Valide des clips dans la revue, puis programme-les ici.')
      : !weekCount ? h('div', { class: 'muted pad center' }, 'Rien cette semaine.') : null);
}
