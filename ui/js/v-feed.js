// Review as a vertical feed, like Reels: one clip per screen, it plays by itself, decide with the buttons or the keyboard.
// Only clips close to the current one hold a video element, so the feed stays smooth with hundreds of clips.
import { h } from './dom.js';
import { store, act, clipAction, render } from './state.js';
import { badge, btn } from './ui.js';
import { icon } from './icons.js';
import { activeFilter, FILTERS, rerender, visibleClips } from './review-actions.js';
import { qaLabel, qaTone } from './v-detail.js';
import { CLIP_STATUS, VIDEO_STATUSES, clipTitle, dur, humanize } from './util.js';

const STORE_KEY = 'review.view';
const ui = () => store.ui.review;
const gone = () => (ui().gone ??= new Set());

export function feedMode() {
  if (ui().mode) return ui().mode;
  try { ui().mode = localStorage.getItem(STORE_KEY) === 'feed' ? 'feed' : 'grid'; } catch { ui().mode = 'grid'; }
  return ui().mode;
}

export function setMode(mode) {
  ui().mode = mode;
  ui().panel = false;
  try { localStorage.setItem(STORE_KEY, mode); } catch { /* per-viewer convenience only */ }
  document.querySelectorAll('video').forEach((v) => v.pause());
  ui().focusFeed = mode === 'feed';
  render();
}

export const feedClips = (d) => visibleClips(d).filter((c) => !gone().has(c.id));

const scroller = () => document.querySelector('.feed');

function currentIndex() {
  const el = scroller();
  return el && el.clientHeight ? Math.round(el.scrollTop / el.clientHeight) : 0;
}

/** New clips arrive while reviewing and can sort above the current one: the clip on screen must not change under the viewer. */
function keepPlace(list) {
  const el = scroller();
  if (!el || !el.clientHeight) return;
  const i = list.findIndex((c) => c.id === ui().sel);
  if (i >= 0 && i !== currentIndex()) el.scrollTop = i * el.clientHeight;
}

/** Plays the clip on screen and only that one. Runs after every render and scroll; safe to call repeatedly. */
function sync() {
  const el = scroller();
  if (!el) return;
  const slide = el.children[currentIndex()];
  el.querySelectorAll('video').forEach((v) => {
    v.muted = Boolean(ui().muted);
    if (!slide?.contains(v) && !v.paused) v.pause();
  });
  const video = slide?.querySelector('video');
  if (!video || ui().paused || !video.paused) return;
  video.play().catch(() => {
    // Browsers can refuse sound before a first click: start muted rather than not at all.
    if (!video.muted) { video.muted = true; ui().muted = true; video.play().catch(() => {}); render(); }
  });
}

function onScroll(d) {
  const i = currentIndex();
  const clip = feedClips(d)[i];
  if (clip && ui().sel !== clip.id) { ui().sel = clip.id; ui().paused = false; render(); }
  sync();
}

export function feedMove(dir) {
  const el = scroller();
  if (!el) return;
  ui().paused = false;
  el.scrollTo({ top: (currentIndex() + dir) * el.clientHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

const SWIPE = 130;          // px of drag to decide
const WHEEL_SWIPE = 160;    // px of horizontal trackpad travel to decide

/** Card flies out to the side, then the decision is sent. A new hook typed and not applied goes with a validation. */
function fly(clip, action) {
  const card = document.querySelector(`[data-clip="${clip.id}"] .feed-c`);
  const draft = (ui().hookDraft ?? {})[clip.id];
  const send = () => (action === 'approve' && draft && draft.trim().length >= 3 && draft.trim() !== (clip.hook ?? '').trim()
    ? approveWithHook(clip, draft.trim()) : feedDecide(clip, action));
  if (!card || matchMedia('(prefers-reduced-motion: reduce)').matches) { send(); return; }
  card.style.transition = 'transform .22s ease-in, opacity .22s ease-in';
  card.style.transform = `translateX(${action === 'approve' ? 120 : -120}vw) rotate(${action === 'approve' ? 18 : -18}deg)`;
  card.style.opacity = '0';
  setTimeout(() => {
    send();
    // If the decision is refused, the clip comes back: it must come back visible.
    setTimeout(() => { card.style.transition = ''; card.style.transform = ''; card.style.opacity = ''; card.style.setProperty('--sw', '0'); card.classList.remove('swiping'); }, 60);
  }, 200);
}

function approveWithHook(clip, hook) {
  gone().add(clip.id);
  render();
  return act(`clip:${clip.id}:rerender`, () => clipAction(clip.id, { action: 'rerender', hook, approve: true }), { ok: 'Validé, montage relancé avec ton hook' })
    .then((r) => { gone().delete(clip.id); clearDraft(clip.id); if (!r) render(); });
}

function clearDraft(id) {
  const { [id]: _, ...rest } = ui().hookDraft ?? {};
  ui().hookDraft = rest;
}

/** Drag the card like Tinder: right validates, left rejects. A short move stays a click on the video. */
function dragStart(e, c) {
  if (e.button !== 0 || c.status !== 'review' || e.target.closest('button, textarea, .feed-bar')) return;
  const card = e.currentTarget;
  const x0 = e.clientX;
  let dx = 0;
  card.setPointerCapture(e.pointerId);
  card.style.transition = 'none';
  const move = (ev) => {
    dx = ev.clientX - x0;
    if (Math.abs(dx) < 6) return;
    card.dataset.dragged = '1';
    card.style.transform = `translateX(${dx}px) rotate(${dx / 22}deg)`;
    card.style.setProperty('--sw', String(Math.max(-1, Math.min(1, dx / SWIPE))));
  };
  const up = () => {
    card.removeEventListener('pointermove', move);
    card.removeEventListener('pointerup', up);
    card.removeEventListener('pointercancel', up);
    if (Math.abs(dx) >= SWIPE) { fly(c, dx > 0 ? 'approve' : 'reject'); return; }
    card.style.transition = 'transform .18s ease-out';
    card.style.transform = '';
    card.style.setProperty('--sw', '0');
    setTimeout(() => { delete card.dataset.dragged; }, 0);
  };
  card.addEventListener('pointermove', move);
  card.addEventListener('pointerup', up);
  card.addEventListener('pointercancel', up);
}

let wheel = { x: 0, timer: 0, locked: false };
/** Two-finger horizontal swipe on the trackpad does the same as a drag. Vertical scrolling is untouched. */
function onWheel(e, d) {
  if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
  e.preventDefault();
  clearTimeout(wheel.timer);
  wheel.timer = setTimeout(() => {
    const card = document.querySelector('.feed-c.swiping');
    if (card && !wheel.locked) { card.style.transform = ''; card.style.setProperty('--sw', '0'); card.classList.remove('swiping'); }
    wheel = { x: 0, timer: 0, locked: false };
  }, 260);
  if (wheel.locked) return;
  const clip = feedClips(d)[currentIndex()];
  if (!clip || clip.status !== 'review') return;
  wheel.x -= e.deltaX;
  const card = document.querySelector(`[data-clip="${clip.id}"] .feed-c`);
  if (card) {
    card.classList.add('swiping');
    card.style.transition = 'none';
    card.style.transform = `translateX(${wheel.x}px) rotate(${wheel.x / 22}deg)`;
    card.style.setProperty('--sw', String(Math.max(-1, Math.min(1, wheel.x / WHEEL_SWIPE))));
  }
  if (Math.abs(wheel.x) >= WHEEL_SWIPE) { wheel.locked = true; fly(clip, wheel.x > 0 ? 'approve' : 'reject'); }
}

// ---- live hook over the video
const layerTimers = {};
async function loadLayer(c, text) {
  try {
    const res = await fetch(`/api/clips/${encodeURIComponent(c.id)}/hook-preview?layer=1&hook=${encodeURIComponent(text)}`);
    if (res.ok) { ui().layer = { ...ui().layer, [c.id]: await res.text() }; render(); }
  } catch { /* preview only */ }
}

function typeHook(c, text) {
  ui().hookDraft = { ...ui().hookDraft, [c.id]: text };
  clearTimeout(layerTimers[c.id]);
  layerTimers[c.id] = setTimeout(() => loadLayer(c, text), 90);
  render();
}

function applyHook(c) {
  const draft = (ui().hookDraft ?? {})[c.id]?.trim();
  if (!draft || draft.length < 3 || draft === (c.hook ?? '').trim()) return;
  rerender(c, { hook: draft }, 'Montage relancé avec ton hook').then((r) => { if (r) { clearDraft(c.id); render(); } });
}

function hookField(c) {
  if (!['review', 'approved', 'qa_failed'].includes(c.status)) return null;
  const draft = (ui().hookDraft ?? {})[c.id];
  const dirty = draft !== undefined && draft.trim() !== (c.hook ?? '').trim();
  return h('div', { class: 'feed-hook' },
    h('textarea', {
      rows: 2, maxlength: 160, value: draft ?? c.hook ?? '', 'aria-label': 'Hook de la vidéo', placeholder: 'Écris ton hook',
      oninput: (e) => typeHook(c, e.target.value),
      onkeydown: (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); applyHook(c); }
        if (e.key === 'Escape') { clearDraft(c.id); render(); e.target.blur(); }
      },
    }),
    dirty ? h('span', { class: 'muted sm' }, 'Entrée : refaire avec ce hook · Valider ou swipe à droite : valider avec ce hook · Échap : annuler') : null);
}

/** Lays the typed hook over the video, scaled to the player. */
function hookLayer(c) {
  const draft = (ui().hookDraft ?? {})[c.id];
  const html = (ui().layer ?? {})[c.id];
  if (draft === undefined || draft.trim() === (c.hook ?? '').trim() || !html) return null;
  return h('div', { class: 'feed-layer', 'aria-hidden': 'true' }, h('iframe', { key: 'l', srcdoc: html, tabindex: '-1', title: 'Aperçu du hook' }));
}

function fitLayers() {
  document.querySelectorAll('.feed-layer').forEach((l) => {
    const f = l.querySelector('iframe');
    if (f) f.style.transform = `scale(${l.clientWidth / 1080})`;
  });
}
addEventListener('resize', fitLayers);

/** The clip leaves at once and the next one takes its place; it comes back only if the server refuses. */
export function feedDecide(clip, action) {
  gone().add(clip.id);
  ui().paused = false;
  render();
  const undo = action === 'reject' ? { label: 'Annuler', fn: () => { gone().delete(clip.id); return act(`undo:${clip.id}`, () => clipAction(clip.id, { action: 'reopen' }), { ok: 'Remis en revue' }); } } : null;
  return act(`clip:${clip.id}:${action}`, () => clipAction(clip.id, { action }), {
    ok: action === 'approve' ? 'Clip validé' : action === 'reject' ? 'Clip rejeté' : 'Remis en revue', undo,
  }).then((r) => { gone().delete(clip.id); if (!r) render(); });
}

export function feedTogglePlay() {
  const video = scroller()?.children[currentIndex()]?.querySelector('video');
  if (!video) return;
  if (video.paused) { ui().paused = false; video.play().catch(() => {}); } else { ui().paused = true; video.pause(); }
  render();
}

export function feedToggleMute() {
  ui().muted = !ui().muted;
  sync();
  render();
}

function seek(e) {
  const bar = e.currentTarget;
  const video = bar.parentElement.querySelector('video');
  if (!video?.duration) return;
  const box = bar.getBoundingClientRect();
  video.currentTime = ((e.clientX - box.left) / box.width) * video.duration;
}

function stage(c, near, current) {
  if (!VIDEO_STATUSES.has(c.status)) {
    return h('div', { class: 'feed-v ph' }, h('b', null, CLIP_STATUS[c.status] || c.status), c.error ? h('span', { class: 'err-t' }, c.error.slice(0, 200)) : null);
  }
  const poster = `/media/${c.id}/poster.jpg`;
  return h('div', { class: 'feed-v' },
    near
      ? h('video', {
        key: 'v', src: `/media/${c.id}/final.mp4`, poster, playsinline: true, loop: true, preload: 'auto', 'aria-label': clipTitle(c),
        onclick: (e) => { if (!e.target.closest('.feed-c')?.dataset.dragged) feedTogglePlay(); },
        ontimeupdate: (e) => {
          const fill = e.target.parentElement.querySelector('.feed-bar i');
          if (fill && e.target.duration) fill.style.width = `${(e.target.currentTime / e.target.duration) * 100}%`;
        },
      })
      : h('img', { key: 'p', src: poster, alt: '', loading: 'lazy' }),
    hookLayer(c),
    h('div', { class: 'feed-stamp ok', 'aria-hidden': 'true' }, 'VALIDER'),
    h('div', { class: 'feed-stamp no', 'aria-hidden': 'true' }, 'REJETER'),
    current && ui().paused ? h('div', { class: 'feed-paused', 'aria-hidden': 'true' }, 'Pause') : null,
    h('button', { type: 'button', class: 'feed-mute', 'aria-label': ui().muted ? 'Activer le son' : 'Couper le son', onclick: (e) => { e.stopPropagation(); feedToggleMute(); } }, ui().muted ? 'Son coupé' : 'Son'),
    near ? h('div', { class: 'feed-bar', role: 'presentation', onclick: seek }, h('i')) : null);
}

function actions(c) {
  const busy = (a) => store.busy.has(`clip:${c.id}:${a}`);
  if (c.status === 'review') return [
    h('button', { key: 'ok', type: 'button', class: 'feed-btn ok', disabled: busy('approve'), onclick: () => fly(c, 'approve') }, icon('check', 22), h('span', null, 'Valider')),
    h('button', { key: 'no', type: 'button', class: 'feed-btn no', disabled: busy('reject'), onclick: () => fly(c, 'reject') }, icon('x', 22), h('span', null, 'Rejeter'))];
  if (c.status === 'qa_failed') return [
    h('button', { key: 're', type: 'button', class: 'feed-btn', disabled: busy('rerender'), onclick: () => rerender(c, {}) }, icon('refresh', 22), h('span', null, 'Refaire')),
    h('button', { key: 'no', type: 'button', class: 'feed-btn no', disabled: busy('reject'), onclick: () => feedDecide(c, 'reject') }, icon('x', 22), h('span', null, 'Rejeter'))];
  if (['approved', 'rejected', 'weak'].includes(c.status)) return [
    h('button', { key: 'back', type: 'button', class: 'feed-btn', disabled: busy('reopen'), onclick: () => feedDecide(c, 'reopen') }, icon('undo', 22), h('span', null, 'En revue'))];
  return [];
}

function info(c) {
  const note = c.viral ?? c.hook_score;
  return h('div', { class: 'feed-info' },
    note != null ? h('div', { class: 'feed-note' }, h('b', { class: 'tnum' }, note), h('span', { class: 'muted sm' }, '/100')) : null,
    h('div', { class: 'hook' }, clipTitle(c)),
    c.caption ? h('p', { class: 'feed-caption' }, c.caption) : null,
    h('div', { class: 'row meta' },
      c.approved_by === 'manual' ? badge('Validé par toi', 'ok') : null,
      c.uploaded ? badge('Ton upload', 'accent') : null,
      c.stale ? badge(`Daté : ${c.age_days} jours`, 'amber') : null,
      c.qa_status ? badge(qaLabel[c.qa_status], qaTone[c.qa_status]) : null,
      c.hook_type ? badge(humanize(c.hook_type)) : null,
      c.qa?.tech?.duration ? badge(dur(c.qa.tech.duration)) : null),
    c.viral_why?.length ? h('ul', { class: 'why sm' }, c.viral_why.slice(0, 3).map((w, i) => h('li', { key: i }, w))) : null,
    h('div', { class: 'row' },
      btn('Autres hooks, légende', { small: true, onclick: () => { ui().panel = !ui().panel; ui().sel = c.id; render(); } }),
      btn(c.text_hook === 0 ? 'Remettre le hook texte' : 'Sans hook texte', { small: true, busy: store.busy.has(`clip:${c.id}:rerender`), onclick: () => rerender(c, { textHook: c.text_hook === 0 }, c.text_hook === 0 ? 'Montage relancé avec le hook texte' : 'Montage relancé sans le hook texte') })));
}

export function feed(d, toolbar) {
  const list = feedClips(d);
  const held = list.findIndex((c) => c.id === ui().sel);
  const cur = held >= 0 ? held : Math.min(currentIndex(), Math.max(0, list.length - 1));
  if (held < 0) ui().sel = list[cur]?.id ?? null;
  requestAnimationFrame(() => {
    keepPlace(list);
    // Keeps Space on the video rather than on the button that was just clicked.
    if (ui().focusFeed) { ui().focusFeed = false; scroller()?.focus({ preventScroll: true }); }
    sync();
    fitLayers();
  });
  const f = FILTERS.find((x) => x.k === activeFilter(d));
  return h('div', { key: 'feed-wrap', class: 'feed-wrap' },
    h('div', { class: 'feed-top' }, toolbar, h('span', { class: 'muted sm tnum feed-count' }, list.length ? `${cur + 1} / ${list.length}` : '')),
    list.length
      ? h('div', { key: `feed-${f.k}`, class: 'feed', tabindex: '-1', onscroll: () => onScroll(d), onwheel: (e) => onWheel(e, d) },
        list.map((c, i) => {
          const distance = Math.abs(i - cur);
          return h('section', { key: c.id, class: 'feed-s', 'data-clip': c.id, 'aria-label': clipTitle(c) },
            distance <= 6 ? h('div', { class: 'feed-c', onpointerdown: distance === 0 ? (e) => dragStart(e, c) : null },
              stage(c, distance <= 1, distance === 0),
              h('div', { class: 'feed-side' }, h('div', { class: 'feed-actions' }, actions(c)), distance === 0 ? hookField(c) : null, info(c))) : null);
        }))
      : h('div', { class: 'feed-empty muted' }, `Rien dans « ${f.label} ».`));
}

// Keyboard in feed mode: returns true when handled.
export function feedKey(e, d) {
  const k = e.key.toLowerCase();
  const clip = feedClips(d)[currentIndex()];
  if (k === 'j' || k === 'arrowdown') { feedMove(1); return true; }
  if (k === 'k' || k === 'arrowup') { feedMove(-1); return true; }
  if (k === ' ') { feedTogglePlay(); return true; }
  if (k === 'm') { feedToggleMute(); return true; }
  if (k === 'escape' && ui().panel) { ui().panel = false; render(); return true; }
  if (!clip) return false;
  if ((k === 'a' || k === 'arrowright') && clip.status === 'review') { fly(clip, 'approve'); return true; }
  if ((k === 'r' || k === 'arrowleft') && ['review', 'qa_failed'].includes(clip.status)) { fly(clip, 'reject'); return true; }
  return false;
}
