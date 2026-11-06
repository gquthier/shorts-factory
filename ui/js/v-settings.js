import { h } from './dom.js';
import { store, act, render } from './state.js';
import { post, del } from './api.js';
import { card, pageHead, btn, toggle, badge, loading } from './ui.js';

const save = (body, ok) => act('settings', () => post('/api/settings', body), { ok });
const on = (s, k) => s[k] === '1';
const ui = () => store.ui.settings;

function rowSwitch(s, key, title, text, extra) {
  return h('div', { key, class: 'setting' },
    h('div', { class: 'grow' }, h('div', { class: 'setting-t' }, title), h('p', { class: 'muted' }, text), extra || null),
    toggle(on(s, key), (v) => save({ [key]: v ? '1' : '0' }), title, store.busy.has('settings')));
}

function num(s, key, label, min, max, step = 1, unit = '', ok = 'Enregistré') {
  return h('label', { key, class: 'numf' }, h('span', { class: 'muted' }, label),
    h('div', { class: 'row nowrap' },
      h('input', { type: 'number', min, max, step, value: s[key], onchange: (e) => { const x = Number(e.target.value); if (x >= min && x <= max) save({ [key]: x }, ok); else render(); } }),
      unit ? h('span', { class: 'muted' }, unit) : null));
}

function threshold(s) {
  const v = ui().threshold ?? Number(s.auto_approve_min_score);
  return h('div', { class: 'row nowrap thr' }, h('span', { class: 'muted' }, 'Note minimum'),
    h('input', { type: 'range', min: 0, max: 100, step: 1, value: v, 'aria-label': 'Note minimum', oninput: (e) => { ui().threshold = Number(e.target.value); render(); }, onchange: (e) => { ui().threshold = null; save({ auto_approve_min_score: Number(e.target.value) }, 'Note enregistrée'); } }),
    h('b', { class: 'tnum' }, v));
}

function volume(s, a) {
  const next = a.nextIncreaseIn == null ? 'Volume stable.' : a.nextIncreaseIn === 1 ? 'Prochaine hausse demain.' : `Prochaine hausse dans ${a.nextIncreaseIn} jours.`;
  return card('Volume par jour', h('div', { class: 'settings' },
    h('div', { class: 'row gap' },
      num(s, 'volume_start', 'Clips par jour', 0, 200),
      num(s, 'volume_step', 'Augmenter de', 0, 50, 1, 'clips'),
      num(s, 'volume_every_days', 'Tous les', 1, 60, 1, 'jours'),
      num(s, 'volume_max', 'Plafond', 1, 200, 1, 'par jour')),
    h('div', { class: 'row meta' },
      badge(`Aujourd'hui : ${a.volumeToday}`, 'accent'), badge(`Dans 7 jours : ${a.volumeIn7}`), badge(`Dans 30 jours : ${a.volumeIn30}`),
      h('span', { class: 'muted' }, next)),
    h('p', { class: 'muted' }, 'Par réseau : un même clip part une fois sur Instagram, une fois sur TikTok, une fois sur YouTube. Changer ces chiffres relance la croissance depuis aujourd\'hui.')));
}

function trypost(s) {
  return card('TryPost', h('div', { class: 'row between' },
    h('div', null, h('div', { class: 'row nowrap' }, badge(s.trypost_configured ? 'Connecté' : 'Non connecté', s.trypost_configured ? 'ok' : 'amber')),
      h('p', { class: 'muted' }, s.trypost_base_url)),
    s.trypost_configured
      ? (ui().disc
        ? h('div', { class: 'row' }, h('span', { class: 'muted' }, 'La publication s\'arrêtera.'),
          btn('Déconnecter', { kind: 'danger', small: true, onclick: () => { ui().disc = false; act('settings', () => del('/api/trypost/key'), { ok: 'TryPost déconnecté' }); } }),
          btn('Annuler', { small: true, onclick: () => { ui().disc = false; render(); } }))
        : btn('Déconnecter', { small: true, onclick: () => { ui().disc = true; render(); } }))
      : null));
}

export function settings() {
  const d = store.data;
  if (!d) return h('div', { key: 'settings', class: 'page' }, pageHead('Réglages'), loading(3));
  const s = d.settings;
  const a = d.autopilot;
  return h('div', { key: 'settings', class: 'page narrow' }, pageHead('Réglages'),
    card('Pilote automatique', h('div', { class: 'settings' },
      rowSwitch(s, 'autopilot', 'Publier tout seul', 'Chaque jour, l\'app remplit les créneaux dans cet ordre : tes clips validés et uploadés, tes clips validés, tes uploads, puis les autres par note. Les clips datés (vieille vidéo sur un sujet qui passe vite, comme une sortie d\'outil) passent en dernier. Rien ne part tant qu\'aucun compte n\'est activé dans Comptes.'),
      rowSwitch(s, 'auto_approve_when_empty', 'Valider automatiquement si plus rien n\'est validé', 'Quand tes validations ne couvrent plus les créneaux d\'aujourd\'hui et de demain, l\'app valide elle-même les meilleurs clips.', on(s, 'auto_approve_when_empty') ? threshold(s) : null),
      rowSwitch(s, 'auto_approve_allow_warn', 'Accepter les clips avec une alerte qualité', 'Coupé : seuls les clips sans aucune alerte peuvent être validés sans toi.'),
      rowSwitch(s, 'post_as_draft', 'Envoyer en brouillon dans TryPost', 'Rien n\'est publié : les posts t\'attendent dans TryPost.'))),
    card('Montage', h('div', { class: 'settings' },
      rowSwitch(s, 'create_new', 'Créer de nouveaux clips', 'Coupé : aucune nouvelle vidéo n\'est téléchargée ni découpée. Les clips déjà en cours se terminent, et la publication continue avec ce qui est validé.'),
      rowSwitch(s, 'text_hook', 'Hook texte à l\'écran', 'Coupé : les nouveaux montages sortent sans le texte du dessus. Pour un seul clip, utilise « Sans hook texte » dans sa fiche.'),
      rowSwitch(s, 'caption_unique', 'Description unique pour tous', 'Allumé : chaque post part avec le texte ci-dessous. Éteint : chaque clip garde sa propre description.',
        h('div', { class: 'stack-s', style: 'margin-top:8px' },
          h('textarea', { rows: 3, 'aria-label': 'Description de tous les posts', value: ui().caption ?? s.caption_text, oninput: (e) => { ui().caption = e.target.value; render(); } }),
          h('div', { class: 'row end' }, btn('Enregistrer', { small: true, kind: ui().caption !== undefined && ui().caption !== s.caption_text ? 'primary' : '', disabled: ui().caption === undefined || ui().caption === s.caption_text || !ui().caption.trim(), busy: store.busy.has('settings'), onclick: () => save({ caption_text: ui().caption }, 'Description enregistrée').then(() => { ui().caption = undefined; render(); }) })))),
      rowSwitch(s, 'cold_open', 'Rejouer la phrase choc en ouverture', 'Quand un clip a une phrase forte, ces 3 à 5 secondes passent tout au début, puis la vidéo reprend depuis son début.'))),
    volume(s, a),
    card('Heures de publication', h('div', { class: 'settings' },
      h('div', { class: 'row gap' },
        num(s, 'post_start_hour', 'Dès', 0, 23, 1, 'h'), num(s, 'post_end_hour', "Jusqu'à", 0, 23, 1, 'h'), num(s, 'post_min_gap_hours', 'Écart minimum', 0.25, 24, 0.25, 'h')),
      h('p', { class: 'muted' }, 'Les posts sont répartis régulièrement dans cette plage selon le volume du jour, puis décalés au hasard de 35 minutes maximum, avant ou après.'))),
    trypost(s));
}
