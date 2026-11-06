import { h } from './dom.js';
import { store, render, go } from './state.js';
import { btn, empty, loading, pageHead, badge, kbd } from './ui.js';
import { icon } from './icons.js';
import { FILTERS, counts, activeFilter, visibleClips, select, decide, rerender, exportApproved, move, togglePlay } from './review-actions.js';
import { detail, qaTone, qaLabel } from './v-detail.js';
import { feed, feedClips, feedKey, feedMode, setMode } from './v-feed.js';
import { VIDEO_STATUSES, CLIP_STATUS, humanize, dur, clipTitle } from './util.js';

const scoreTone = (s) => (s >= 75 ? 'ok' : s >= 60 ? 'accent' : 'mute');

function media(c) {
  if (!VIDEO_STATUSES.has(c.status)) {
    return h('div', { class: 'ph' }, h('b', null, CLIP_STATUS[c.status] || c.status), c.error ? h('span', { class: 'err-t' }, c.error.slice(0, 140)) : h('span', { class: 'muted' }, c.start != null ? `${dur(c.start)} → ${dur(c.end)}` : ''));
  }
  return h('video', { preload: 'none', controls: true, playsinline: true, loop: true, controlslist: 'nodownload noplaybackrate', poster: `/media/${c.id}/poster.jpg`, src: `/media/${c.id}/final.mp4`, 'aria-label': clipTitle(c) });
}

function cardActions(d, c) {
  const b = (a) => store.busy.has(`clip:${c.id}:${a}`);
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
  if (c.status === 'review') return [
    btn('Valider', { kind: 'ok', small: true, icon: 'check', busy: b('approve'), onclick: stop(() => decide(d, c, 'approve')) }),
    btn('Rejeter', { kind: 'danger', small: true, icon: 'x', busy: b('reject'), onclick: stop(() => decide(d, c, 'reject')) })];
  if (c.status === 'qa_failed') return [btn('Refaire', { kind: 'primary', small: true, icon: 'refresh', busy: b('rerender'), onclick: stop(() => rerender(c, {})) })];
  if (['approved', 'rejected', 'weak'].includes(c.status)) return [btn('Remettre en revue', { small: true, icon: 'undo', busy: b('reopen'), onclick: stop(() => decide(d, c, 'reopen')) })];
  return [];
}

function clipCard(d, c) {
  const sel = store.ui.review.sel === c.id;
  const top = c.qa?.findings?.find((f) => f.severity === 'fail') || c.qa?.findings?.[0];
  return h('article', {
    key: c.id, class: `card ${sel ? 'sel' : ''}`, 'data-clip': c.id, tabindex: '0', 'aria-label': clipTitle(c), 'aria-current': sel ? 'true' : null,
    onclick: () => select(c.id, { open: true }),
    onfocus: () => { if (store.ui.review.sel !== c.id) { store.ui.review.sel = c.id; render(); } },
  },
  h('div', { class: 'card-m' }, media(c),
    h('div', { class: 'ov tl' }, (c.viral ?? c.hook_score) != null ? badge(c.viral ?? c.hook_score, scoreTone(c.viral ?? c.hook_score), 'Note de viralité') : null),
    h('div', { class: 'ov tr' }, c.stale ? badge('Daté', 'amber') : c.qa_status ? badge(qaLabel[c.qa_status], qaTone[c.qa_status]) : null),
    ),
  h('div', { class: 'card-b' },
    h('div', { class: 'hook' }, clipTitle(c)),
    h('div', { class: 'row meta' }, c.hook_type ? badge(humanize(c.hook_type)) : null, c.end != null ? badge(dur(c.end - c.start)) : null),
    c.status === 'qa_failed' && top ? h('div', { class: 'err-t sm clamp2' }, top.message) : null,
    h('div', { class: 'card-a' }, cardActions(d, c))));
}

function viewSwitch() {
  const mode = feedMode();
  const one = (id, label) => h('button', { key: id, type: 'button', class: `pill ${mode === id ? 'on' : ''}`, 'aria-pressed': mode === id ? 'true' : 'false', onclick: () => setMode(id) }, label);
  return h('div', { class: 'pills view-switch', role: 'group', 'aria-label': 'Vue' }, one('grid', 'Grille'), one('feed', 'Scroll'));
}

function toolbar(d) {
  const cs = counts(d); const active = activeFilter(d);
  const pills = FILTERS.filter((f) => f.always || cs[f.k]).map((f) => h('button', {
    key: f.k, type: 'button', class: `pill ${active === f.k ? 'on' : ''}`, 'aria-pressed': active === f.k ? 'true' : 'false',
    onclick: () => { store.ui.review.filter = f.k; store.ui.review.sel = null; render(); },
  }, f.label, h('b', { class: 'tnum' }, cs[f.k])));
  return h('div', { class: 'toolbar' }, h('div', { class: 'row nowrap' }, viewSwitch(), h('div', { class: 'pills' }, pills)),
    h('div', { class: 'row nowrap' },
      h('span', { class: 'keys muted sm' }, kbd('J'), kbd('K'), feedMode() === 'feed' ? ' défiler ' : ' naviguer ', kbd('A'), ' valider ', kbd('R'), ' rejeter ', kbd('Espace'), ' lire', feedMode() === 'feed' ? [' ', kbd('M'), ' son ', kbd('←'), kbd('→'), ' ou swipe : rejeter, valider'] : null),
      cs.approved && feedMode() === 'grid' ? btn('Exporter les validés', { small: true, icon: 'upload', busy: store.busy.has('export'), onclick: exportApproved }) : null));
}

export function review() {
  const d = store.data;
  if (!d) return h('div', { key: 'review', class: 'page' }, pageHead('Revue'), loading(4));
  if (feedMode() === 'feed') {
    const r = store.ui.review;
    const list = feedClips(d);
    const sel = list.find((c) => c.id === r.sel);
    const showPanel = r.panel && sel;
    return h('div', { key: 'review', class: `review feed-mode ${showPanel ? 'with-panel' : ''}` },
      h('div', { class: 'review-main' }, feed(d, toolbar(d))),
      showPanel ? detail(d, sel, list) : null);
  }
  const list = visibleClips(d);
  const r = store.ui.review;
  const sel = list.find((c) => c.id === r.sel);
  const showPanel = r.panel && sel;
  const f = FILTERS.find((x) => x.k === activeFilter(d));
  const body = list.length
    ? h('div', { class: 'grid' }, list.map((c) => clipCard(d, c)))
    : empty(`Rien dans « ${f.label} »`, f.k === 'review' ? 'Les nouveaux clips arrivent ici dès que le montage et le contrôle sont finis.' : 'Aucun clip dans cet état.',
      f.k === 'review' ? btn('Ajouter une source', { small: true, onclick: () => go('sources') }) : null);
  return h('div', { key: 'review', class: `review ${showPanel ? 'with-panel' : ''}` },
    h('div', { class: 'review-main' }, pageHead('Revue'), toolbar(d), body),
    showPanel ? detail(d, sel, list) : null);
}

// Keyboard: returns true when the key was handled.
export function reviewKey(e) {
  const d = store.data; if (!d) return false;
  if (feedMode() === 'feed') return feedKey(e, d);
  const list = visibleClips(d);
  const sel = list.find((c) => c.id === store.ui.review.sel);
  const k = e.key.toLowerCase();
  if (k === 'j') { move(d, 1); return true; }
  if (k === 'k') { move(d, -1); return true; }
  if (k === 'escape') { if (store.ui.review.panel) { store.ui.review.panel = false; render(); return true; } return false; }
  if (!sel) return false;
  if (k === ' ') { togglePlay(sel.id); return true; }
  if (k === 'enter') { store.ui.review.panel = true; render(); return true; }
  if (k === 'a' && sel.status === 'review') { decide(d, sel, 'approve'); return true; }
  if (k === 'r' && ['review', 'qa_failed'].includes(sel.status)) { decide(d, sel, 'reject'); return true; }
  return false;
}
