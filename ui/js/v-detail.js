import { h } from './dom.js';
import { store, render } from './state.js';
import { btn, iconBtn, badge } from './ui.js';
import { icon } from './icons.js';
import { rerender, saveCaption, decide, move } from './review-actions.js';
import { hookEditor, setHookDraft } from './hook-editor.js';
import { CLIP_STATUS, humanize, pct, dur, clipTitle } from './util.js';

export const qaTone = { pass: 'ok', warn: 'amber', fail: 'bad' };
export const qaLabel = { pass: 'QA ok', warn: 'QA à revoir', fail: 'QA échec' };
const sevIcon = { fail: 'x', warn: 'alert', info: 'check' };

function qaBlock(c) {
  const q = c.qa;
  if (!q) return h('div', { class: 'muted' }, 'Pas encore contrôlé.');
  const f = q.findings || [];
  const a = q.audio; const v = q.visual;
  const line = [
    a && typeof a.recall === 'number' ? `Mots réentendus ${pct(a.recall)}` : null,
    a && typeof a.syncMedian === 'number' ? `Synchro ${a.syncMedian.toFixed(2).replace('.', ',')} s` : null,
    v && typeof v.readableShare === 'number' ? `Sous-titres lus ${pct(v.readableShare)}` : null,
  ].filter(Boolean);
  return h('div', { class: 'stack-s' },
    f.length ? h('ul', { class: 'findings' }, f.map((x, i) => h('li', { key: i, class: `finding ${x.severity}` }, icon(sevIcon[x.severity] || 'alert', 14), h('span', null, x.message))))
      : h('div', { class: 'muted' }, 'Aucun défaut relevé.'),
    line.length ? h('div', { class: 'qaline tnum' }, line.map((t, i) => h('span', { key: i }, t))) : null);
}

const VIDEO_OK = new Set(['review', 'approved', 'scheduled', 'qa_failed', 'rejected', 'weak', 'exported']);

function hooks(c) {
  const alts = c.hooks || [];
  if (!alts.length) return h('div', { class: 'muted' }, 'Pas d\'autre hook.');
  return h('ul', { class: 'alts' }, alts.map((x) => {
    const cur = x.text === c.hook;
    return h('li', { key: x.text }, h('button', {
      type: 'button', class: `alt ${cur ? 'cur' : ''}`, disabled: cur || store.busy.has(`clip:${c.id}:rerender`),
      title: cur ? 'Hook actuel' : 'Mettre ce hook dans l\'éditeur', onclick: () => setHookDraft(c, x.text),
    }, h('b', { class: 'tnum score-s' }, x.score), h('span', { class: 'grow' }, x.text), h('em', null, cur ? 'actuel' : humanize(x.type))));
  }));
}

function field(label, body, key) { return h('div', { class: 'field', key }, h('div', { class: 'field-l' }, label), body); }

export function detail(d, c, list) {
  const r = store.ui.review;
  const draft = r.draft?.[c.id];
  const dirty = draft !== undefined && draft !== c.caption;
  const tpl = r.tpl?.[c.id] ?? c.template ?? d.templates[0];
  const i = list.findIndex((x) => x.id === c.id);
  const busy = (a) => store.busy.has(`clip:${c.id}:${a}`);
  const canDecide = c.status === 'review';
  const actions = canDecide
    ? [btn('Valider', { kind: 'ok', icon: 'check', busy: busy('approve'), onclick: () => decide(d, c, 'approve') }), btn('Rejeter', { kind: 'danger', icon: 'x', busy: busy('reject'), onclick: () => decide(d, c, 'reject') })]
    : c.status === 'qa_failed'
      ? [btn('Refaire le montage', { kind: 'primary', icon: 'refresh', busy: busy('rerender'), onclick: () => rerender(c, {}) }), btn('Rejeter', { kind: 'danger', icon: 'x', busy: busy('reject'), onclick: () => decide(d, c, 'reject') })]
      : ['approved', 'rejected', 'weak'].includes(c.status) ? [btn('Remettre en revue', { icon: 'undo', busy: busy('reopen'), onclick: () => decide(d, c, 'reopen') })] : [];

  return h('aside', { key: `detail-${c.id}`, class: 'detail', 'aria-label': 'Détail du clip' },
    h('header', { class: 'detail-h' },
      h('span', { class: 'muted sm tnum' }, `${i + 1} / ${list.length}`),
      h('div', { class: 'row nowrap' }, iconBtn('left', 'Clip précédent (K)', () => move(d, -1)), iconBtn('right', 'Clip suivant (J)', () => move(d, 1)), iconBtn('x', 'Fermer (Échap)', () => { r.panel = false; render(); }))),
    h('div', { class: 'detail-b' },
      h('h2', { class: 'detail-hook' }, clipTitle(c)),
      h('div', { class: 'row meta' }, badge(CLIP_STATUS[c.status] || c.status, c.status === 'qa_failed' || c.status === 'failed' ? 'bad' : 'mute'), c.approved_by === 'manual' ? badge('Validé par toi', 'ok') : c.approved_by === 'auto' ? badge('Validé auto') : null, c.uploaded ? badge('Ton upload', 'accent') : null, c.stale ? badge(`Daté : ${c.age_days} jours`, 'amber') : null,
        c.qa_status && c.status !== 'qa_failed' ? badge(qaLabel[c.qa_status], qaTone[c.qa_status]) : null,
        c.hook_score != null ? badge(`Hook ${c.hook_score}/100`, 'accent') : null, badge(dur(c.end - c.start)), c.hook_type ? badge(humanize(c.hook_type)) : null),
      c.error ? h('div', { class: 'callout bad' }, c.error.slice(0, 400)) : null,
      VIDEO_OK.has(c.status) && c.template ? field('Hook', hookEditor(c), 'hookedit') : null,
      c.viral != null ? field(`Note de viralité : ${c.viral}/100`, h('ul', { class: 'why' }, (c.viral_why || []).map((w, i) => h('li', { key: i }, w))), 'viral') : null,
      field('Contrôle qualité', qaBlock(c), 'qa'),
      field('Autres hooks · clique pour l\'éditer', hooks(c), 'hooks'),
      field('Hook texte', btn(c.text_hook === 0 ? 'Remettre le hook texte' : 'Sans hook texte', { small: true, busy: busy('rerender'), onclick: () => rerender(c, { textHook: c.text_hook === 0 }, c.text_hook === 0 ? 'Montage relancé avec le hook texte' : 'Montage relancé sans le hook texte') }), 'texthook'),
      field('Format', h('div', { class: 'row nowrap' },
        h('select', { 'aria-label': 'Template', value: tpl, onchange: (e) => { r.tpl = { ...r.tpl, [c.id]: e.target.value }; render(); } }, d.templates.map((t) => h('option', { key: t, value: t }, t))),
        btn('Refaire', { small: true, busy: busy('rerender'), disabled: tpl === c.template, onclick: () => rerender(c, { template: tpl }, 'Montage relancé avec ce template') })), 'tpl'),
      field('Légende', h('div', { class: 'stack-s' },
        h('textarea', { rows: 4, 'aria-label': 'Légende', value: c.caption || '', oninput: (e) => { r.draft = { ...r.draft, [c.id]: e.target.value }; render(); } }),
        h('div', { class: 'row end' }, btn('Enregistrer', { small: true, kind: dirty ? 'primary' : '', disabled: !dirty, busy: busy('caption'), onclick: (e) => saveCaption(c, e.currentTarget.closest('.field').querySelector('textarea')) }))), 'cap'),
      c.why ? field('Pourquoi ce moment', h('p', { class: 'why' }, c.why), 'why') : null,
      c.question ? field('Question', h('p', { class: 'why' }, c.question), 'q') : null,
      field('Source', h('p', { class: 'why tnum' }, `${c.source_title || c.source_id} · ${dur(c.start)} → ${dur(c.end)}`), 'src')),
    actions.length ? h('footer', { class: 'detail-f' }, actions) : null);
}
