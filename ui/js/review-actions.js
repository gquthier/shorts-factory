// Review logic shared by the grid, the detail panel and the keyboard.
import { store, act, clipAction, toast, render } from './state.js';
import { post } from './api.js';
import { markClean } from './dom.js';

export const FILTERS = [
  { k: 'review', label: 'À valider', st: ['review'], always: true },
  { k: 'qa_failed', label: 'QA en échec', st: ['qa_failed'], always: true },
  { k: 'approved', label: 'Validés', st: ['approved'] },
  { k: 'out', label: 'Sortis', st: ['scheduled', 'exported'] },
  { k: 'progress', label: 'En cours', st: ['candidate', 'hooked', 'rendered'] },
  { k: 'rejected', label: 'Rejetés', st: ['rejected', 'weak'] },
  { k: 'failed', label: 'Échecs', st: ['failed'] },
];

export const counts = (d) => Object.fromEntries(FILTERS.map((f) => [f.k, d.clips.filter((c) => f.st.includes(c.status)).length]));

export function activeFilter(d) {
  const r = store.ui.review;
  if (r.filter) return r.filter;
  const c = counts(d);
  return (FILTERS.find((f) => c[f.k]) || FILTERS[0]).k;
}

export function visibleClips(d) {
  const f = FILTERS.find((x) => x.k === activeFilter(d));
  return d.clips.filter((c) => f.st.includes(c.status));
}

export function selected(d) {
  const list = visibleClips(d);
  return list.find((c) => c.id === store.ui.review.sel) || null;
}

export function select(id, { open } = {}) {
  store.ui.review.sel = id;
  if (open !== undefined) store.ui.review.panel = open;
  render();
  requestAnimationFrame(() => document.querySelector(`[data-clip="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
}

export function move(d, dir) {
  const list = visibleClips(d);
  if (!list.length) return;
  const i = list.findIndex((c) => c.id === store.ui.review.sel);
  const next = list[Math.max(0, Math.min(list.length - 1, i < 0 ? 0 : i + dir))];
  select(next.id);
}

export function decide(d, clip, action) {
  const list = visibleClips(d);
  const i = list.findIndex((c) => c.id === clip.id);
  const nextId = (list[i + 1] || list[i - 1])?.id || null;
  const undo = action === 'reject' ? { label: 'Annuler', fn: () => act(`undo:${clip.id}`, () => clipAction(clip.id, { action: 'reopen' }), { ok: 'Remis en revue' }) } : null;
  return act(`clip:${clip.id}:${action}`, () => clipAction(clip.id, { action }), {
    ok: action === 'approve' ? 'Clip validé' : action === 'reject' ? 'Clip rejeté' : 'Remis en revue', undo,
  }).then((r) => { if (r && store.ui.review.sel === clip.id) select(nextId); });
}

export const rerender = (clip, body, label) => act(`clip:${clip.id}:rerender`, () => clipAction(clip.id, { action: 'rerender', ...body }), { ok: label || 'Nouveau montage lancé' });

export function saveCaption(clip, textarea) {
  const caption = store.ui.review.draft?.[clip.id];
  if (caption === undefined) return;
  act(`clip:${clip.id}:caption`, () => clipAction(clip.id, { action: 'caption', caption }), { ok: 'Légende enregistrée' }).then((r) => {
    if (r) { const { [clip.id]: _, ...rest } = store.ui.review.draft; store.ui.review.draft = rest; markClean(textarea); render(); }
  });
}

export const exportApproved = () => act('export', () => post('/api/export'), {
  ok: (r) => `${r?.exported ?? 0} clip(s) exporté(s)${r?.dir ? ` dans ${r.dir}` : ''}${r?.backlog ? `, ${r.backlog} restent pour demain` : ''}`,
});

export function togglePlay(id) {
  const v = document.querySelector(`[data-clip="${CSS.escape(id)}"] video`);
  if (!v) { toast('Pas de vidéo pour ce clip.', 'info'); return; }
  if (v.paused) v.play().catch(() => toast('Lecture impossible.', 'error')); else v.pause();
}

// Only one clip plays at a time.
document.addEventListener('play', (e) => {
  if (e.target.tagName !== 'VIDEO') return;
  document.querySelectorAll('video').forEach((v) => { if (v !== e.target && !v.paused) v.pause(); });
}, true);
