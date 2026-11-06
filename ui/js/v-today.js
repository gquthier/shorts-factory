import { h } from './dom.js';
import { store, derive, go, act, toast } from './state.js';
import { post } from './api.js';
import { card, pageHead, bar, badge, btn, empty, loading, stateTone } from './ui.js';
import { icon } from './icons.js';
import { JOB_LABEL, PUB_STATE, provider, timeOf, clipTitle } from './util.js';

function tile(key, n, label, hint, tone, onclick) {
  return h('button', { type: 'button', key, class: `tile ${n ? tone : 'zero'}`, onclick },
    h('span', { class: 'tile-n tnum' }, n), h('span', { class: 'tile-l' }, label), h('span', { class: 'tile-h' }, n ? hint : 'Rien à faire'));
}

function pilotStrip(d) {
  const a = d.autopilot;
  if (!a) return null;
  const line = !a.on ? 'Pilote automatique coupé : rien ne part sans toi.'
    : !a.trypost ? 'Pilote prêt, en attente de ta clé TryPost (onglet Comptes).'
      : !a.channels ? 'Pilote prêt, active un compte dans Comptes pour lancer la publication.'
        : `${d.settings.post_as_draft === '1' ? 'Mode brouillon, rien n\'est publié' : 'Pilote actif'} : ${a.bookedToday} sur ${a.volumeToday} prévus aujourd'hui, ${a.waitingManual} validés par toi en attente.`;
  return h('div', { key: 'pilot', class: `strip ${a.live ? 'ok' : a.on ? 'warn' : ''}` }, icon(a.live ? 'check' : 'alert', 15), h('span', null, line),
    a.freeGb < 15 ? h('b', null, ` Disque : ${a.freeGb} Go libres.`) : null);
}

function refName(d, ref) {
  const c = d.clips.find((x) => x.id === ref);
  if (c) return clipTitle(c);
  const s = d.sources.find((x) => x.id === ref);
  return s?.title || (ref && ref.length < 40 && !/^\d+:\d+$/.test(ref) ? ref : '');
}

function dayLabel(date) {
  const t = new Date(); const k = (x) => x.toDateString();
  const tm = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1);
  if (k(date) === k(t)) return "Aujourd'hui";
  if (k(date) === k(tm)) return 'Demain';
  return date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

function decisions(d, v) {
  return h('div', { class: 'tiles' },
    tile('t1', v.review, 'Clips à valider', 'Ouvrir la revue', 'accent', () => { store.ui.review.filter = 'review'; go('review'); }),
    tile('t2', v.qaFailed, 'QA en échec', 'Voir les défauts', 'bad', () => { store.ui.review.filter = 'qa_failed'; go('review'); }),
    tile('t3', v.pubErrors, 'Publications en erreur', 'Voir le calendrier', 'bad', () => go('calendar')),
  );
}

function upNext(d, v) {
  const rows = v.upcoming.slice(0, 6).map((p) => {
    const dt = new Date(p.scheduled_at);
    return h('li', { key: p.id, class: 'list-row' },
      h('div', { class: 'when' }, h('b', { class: 'tnum' }, timeOf(dt)), h('span', null, dayLabel(dt))),
      h('div', { class: 'grow' }, h('div', { class: 'ellip' }, p.hook || p.clip_id), h('div', { class: 'muted sm' }, `${p.channel || p.channel_id} · ${provider(p.provider)}`)),
      badge(PUB_STATE[p.state] || p.state, stateTone[p.state]));
  });
  const right = v.approved ? btn(`Programmer ${v.approved} validé${v.approved > 1 ? 's' : ''}`, { small: true, kind: 'primary', busy: store.busy.has('schedule'), onclick: schedule }) : null;
  return card('Prochaines sorties', rows.length ? h('ul', { class: 'list' }, rows) : empty('Rien de prévu', v.approved ? `${v.approved} clip(s) validé(s) attendent d'être programmés.` : 'Valide des clips puis programme-les.'), { right, key: 'next' });
}

export const schedule = () => act('schedule', () => post('/api/schedule'), { ok: (r) => (r?.planned ? `${r.planned} publication(s) programmée(s)` : 'Rien à programmer') });

function goal(d) {
  const n = d.today?.n ?? 0; const t = d.target || 0;
  return card("Aujourd'hui", h('div', null,
    h('div', { class: 'goal' }, h('span', { class: 'goal-n tnum' }, n), h('span', { class: 'goal-t tnum' }, `/ ${t}`), h('span', { class: 'muted' }, 'clips')),
    bar(n, t, n >= t && t ? 'ok' : 'accent'),
    h('div', { class: 'muted sm mt' }, t ? (n >= t ? 'Objectif atteint.' : `Encore ${t - n} pour atteindre l'objectif.`) : 'Pas d\'objectif défini.')), { key: 'goal' });
}

function running(d) {
  const q = d.jobs.filter((j) => j.status === 'queued');
  const rows = d.running.map((r, i) => h('li', { key: `${r.type}:${r.ref}:${i}`, class: 'list-row' },
    h('span', { class: 'pulse', 'aria-hidden': 'true' }),
    h('div', { class: 'grow' }, h('b', null, JOB_LABEL[r.type] || r.type), refName(d, r.ref) ? h('div', { class: 'muted sm ellip' }, refName(d, r.ref)) : null)));
  const queued = q.map((j) => h('span', { key: j.type, class: 'chip' }, `${JOB_LABEL[j.type] || j.type} `, h('b', { class: 'tnum' }, j.n)));
  return card('En cours', h('div', null,
    rows.length ? h('ul', { class: 'list' }, rows) : h('div', { class: 'muted pad' }, 'Rien ne tourne.'),
    queued.length ? h('div', { class: 'chips' }, h('span', { class: 'muted sm' }, 'En attente'), queued) : null), { key: 'run' });
}

export function today() {
  const d = store.data;
  if (!d) return h('div', { key: 'today' }, pageHead("Aujourd'hui"), loading(4));
  const v = derive(d);
  const date = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const todo = v.review + v.qaFailed + v.pubErrors;
  return h('div', { key: 'today', class: 'page' },
    pageHead("Aujourd'hui", date.charAt(0).toUpperCase() + date.slice(1)),
    pilotStrip(d),
    h('div', { class: 'section-l' }, icon('alert', 13), todo ? `À décider · ${todo}` : 'À décider'),
    decisions(d, v),
    h('div', { class: 'cols' }, h('div', { class: 'stack' }, upNext(d, v)), h('div', { class: 'stack' }, goal(d), running(d))));
}
