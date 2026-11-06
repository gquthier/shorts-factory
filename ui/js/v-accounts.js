import { h, markClean } from './dom.js';
import { store, act, render } from './state.js';
import { post } from './api.js';
import { btn, card, pageHead, empty, loading, badge, toggle } from './ui.js';
import { icon } from './icons.js';
import { provider, ago, fromSql } from './util.js';

const setChan = (c, body, ok) => act(`chan:${c.id}`, () => post(`/api/channels/${c.id}`, body), { ok });

function saveKey() {
  const input = document.getElementById('trypost-key');
  const base = document.getElementById('trypost-base');
  const apiKey = input?.value.trim();
  if (!apiKey) { store.ui.accounts.err = 'Colle ta clé API.'; render(); return; }
  store.ui.accounts.err = null;
  const body = { apiKey };
  if (base?.value.trim()) body.baseUrl = base.value.trim();
  act('trypost-key', () => post('/api/trypost/key', body), { ok: (r) => `TryPost connecté · ${r?.integrations ?? 0} compte(s)` }).then((r) => {
    // The key never lives in the page after the request.
    if (input) { input.value = ''; markClean(input); }
    if (!r) store.ui.accounts.err = 'Clé refusée ou TryPost injoignable.';
    render();
  });
}

function setup(d) {
  const a = store.ui.accounts;
  return h('div', { key: 'setup' }, card('Connecte TryPost', h('div', { class: 'stack' },
    h('ol', { class: 'steps-l' },
      h('li', null, 'Ouvre TryPost, puis ', h('b', null, 'Réglages'), ' → ', h('b', null, 'Clés API'), '.'),
      h('li', null, 'Copie la clé API.'),
      h('li', null, 'Colle-la ici : elle est vérifiée puis rangée dans le trousseau macOS.')),
    h('form', { class: 'row nowrap', onsubmit: (e) => { e.preventDefault(); saveKey(); } },
      h('input', { id: 'trypost-key', class: 'grow', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'Clé API TryPost', 'aria-label': 'Clé API TryPost' }),
      btn('Connecter', { kind: 'primary', busy: store.busy.has('trypost-key'), onclick: saveKey })),
    h('details', { class: 'adv' }, h('summary', null, 'Instance auto-hébergée'),
      h('input', { id: 'trypost-base', type: 'url', placeholder: d.settings.trypost_base_url, 'aria-label': 'URL de l\'API TryPost' })),
    a.err ? h('div', { class: 'err-t' }, a.err) : null,
    h('p', { class: 'muted sm' }, icon('lock', 12), ' La clé n\'est jamais réaffichée après l\'envoi.'))));
}

/** An account can grow on its own (YouTube 10 a day, +1 every 3 days) instead of following the general volume. */
function ownVolume(c, busy) {
  if (c.vol_start == null) {
    return h('button', { type: 'button', class: 'linkish sm', disabled: busy, onclick: () => setChan(c, { volume: { start: c.max_per_day > 6 ? 6 : c.max_per_day, step: 1, every: 3 } }, 'Volume propre activé') }, 'Suit le volume général · lui donner son propre volume');
  }
  const save = (patch) => setChan(c, { volume: { start: c.vol_start, step: c.vol_step ?? 0, every: c.vol_every ?? 3, ...patch } }, 'Volume enregistré');
  const n = (value, min, max, key, label) => h('input', { type: 'number', class: 'num-s', min, max, value, 'aria-label': label, disabled: busy, onchange: (e) => { const x = Number(e.target.value); if (x >= min && x <= max) save({ [key]: x }); } });
  return h('div', { class: 'row sm own-vol' },
    h('span', { class: 'muted' }, 'Volume propre :'), n(c.vol_start, 1, 200, 'start', 'Posts par jour au départ'), h('span', { class: 'muted' }, 'par jour, +'),
    n(c.vol_step ?? 0, 0, 50, 'step', 'Hausse'), h('span', { class: 'muted' }, 'tous les'), n(c.vol_every ?? 3, 1, 60, 'every', 'Tous les combien de jours'), h('span', { class: 'muted' }, `jours, depuis le ${c.vol_since ?? ''}`),
    h('button', { type: 'button', class: 'linkish', disabled: busy, onclick: () => setChan(c, { volume: null }, 'Suit le volume général') }, 'revenir au volume général'));
}

function row(c) {
  const busy = store.busy.has(`chan:${c.id}`);
  const on = !!c.enabled && !c.disabled_upstream;
  const cap = c.max_per_day ?? 3;
  return h('li', { key: c.id, class: `chan ${on ? '' : 'off'}` },
    c.picture ? h('img', { class: 'avatar', src: c.picture, alt: '', loading: 'lazy' }) : h('span', { class: 'avatar ph-a' }, (c.name || '?').charAt(0).toUpperCase()),
    h('div', { class: 'grow' },
      h('div', { class: 'chan-n' }, h('b', null, c.name), badge(provider(c.provider)), c.disabled_upstream ? badge('Désactivé dans TryPost', 'amber') : null),
      c.profile ? h('div', { class: 'muted sm' }, `@${String(c.profile).replace(/^@/, '')}`) : null,
      on ? ownVolume(c, busy) : null),
    h('div', { class: 'cap' }, h('span', { class: 'muted sm' }, 'Par jour'),
      h('div', { class: 'stepper' },
        h('button', { type: 'button', 'aria-label': 'Moins', disabled: busy || cap <= 1, onclick: () => setChan(c, { maxPerDay: cap - 1 }) }, '−'),
        h('b', { class: 'tnum' }, cap),
        h('button', { type: 'button', 'aria-label': 'Plus', disabled: busy || cap >= 200, onclick: () => setChan(c, { maxPerDay: cap + 1 }) }, '+'))),
    toggle(!!c.enabled, (v) => setChan(c, { enabled: v }, v ? 'Compte activé' : 'Compte désactivé'), `Activer ${c.name}`, busy || !!c.disabled_upstream));
}

const FORMAT_LABEL = { 'black-frame': 'Cadre noir', 'selfie-headline': 'Vertical + phrase', 'cinema-talk': 'Vertical', 'qa-card': 'Carte Q&A', 'split-board': 'Split visuel' };

/** Which format goes to which account. */
function routes(d) {
  const formats = (d.templates || []).filter((t) => t !== 'split-board');
  if (!d.channels.length || !formats.length) return null;
  const blocked = d.routing || {};
  const allowed = (t, c) => !(blocked[t] || []).includes(c.id);
  const set = (t, c, value) => act(`route-${t}-${c.id}`, () => post('/api/routing', { template: t, channelId: c.id, allowed: value }), { ok: value ? `${FORMAT_LABEL[t] || t} : envoyé sur ${c.name}` : `${FORMAT_LABEL[t] || t} : plus envoyé sur ${c.name}` });
  return card('Quel format sur quel compte', h('div', { class: 'tablewrap' },
    h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', null, 'Format'), d.channels.map((c) => h('th', { key: c.id, class: 'center' }, h('div', null, c.name), h('div', { class: 'muted sm' }, provider(c.provider)))))),
      h('tbody', null, formats.map((t) => h('tr', { key: t },
        h('td', null, FORMAT_LABEL[t] || t),
        d.channels.map((c) => h('td', { key: c.id, class: 'center' },
          h('input', { type: 'checkbox', checked: allowed(t, c), 'aria-label': `${FORMAT_LABEL[t] || t} sur ${c.name}`, disabled: store.busy.has(`route-${t}-${c.id}`), onchange: (e) => set(t, c, e.target.checked) }))))))),
    h('p', { class: 'muted sm mt' }, 'Un compte désactivé plus haut ne reçoit rien, quelles que soient ces cases.')), { key: 'routes' });
}

export function accounts() {
  const d = store.data;
  if (!d) return h('div', { key: 'accounts', class: 'page' }, pageHead('Comptes'), loading(3));
  if (!d.settings.trypost_configured) return h('div', { key: 'accounts', class: 'page' }, pageHead('Comptes', 'Les réseaux sur lesquels l\'usine publie.'), setup(d));
  const last = d.channels.map((c) => c.synced_at).filter(Boolean).sort().pop();
  return h('div', { key: 'accounts', class: 'page' },
    pageHead('Comptes', last ? `Synchro ${ago(fromSql(last))}` : 'Jamais synchronisé', [
      btn('Resynchroniser', { icon: 'refresh', busy: store.busy.has('chan-sync'), onclick: () => act('chan-sync', () => post('/api/channels/sync'), { ok: (r) => `${Array.isArray(r?.channels) ? r.channels.length : (r?.channels ?? 0)} compte(s) synchronisé(s)` }) })]),
    d.autopilot?.on ? h('div', { key: 'pilot', class: 'strip warn' }, icon('alert', 15), h('span', null, d.settings.post_as_draft === '1' ? 'Mode brouillon : tout part en brouillon dans TryPost, rien n\'est publié.' : 'Pilote actif : activer un compte autorise l\'app à y publier toute seule.')) : null,
    d.channels.length ? card(null, h('ul', { class: 'list chans' }, d.channels.map(row)))
      : empty('Aucun compte', 'Connecte un réseau dans TryPost, puis resynchronise.'),
    routes(d));
}
