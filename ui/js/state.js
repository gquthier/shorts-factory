// Single mutable store (replaced wholesale on each poll) + UI state + toasts.
import { get, post } from './api.js';

export const store = {
  data: null,        // /api/state
  stats: null, outliers: null,
  offline: false,
  route: 'today',
  toasts: [],
  busy: new Set(),   // ids of in-flight actions
  ui: {
    review: { filter: null, sel: null, panel: false },
    sources: { kind: 'youtube', url: '', rights: false, uploads: [], over: false },
    calendar: { weekStart: null },
    outliers: { sort: 'ratio', dir: -1, lang: '', hook: '' },
    ideas: { open: new Set(), copied: null },
    settings: { confirmBoth: false, threshold: null },
    accounts: { key: '', keyBusy: false },
    stats: { platform: '', channel: '', days: 30, metric: 'views', minimum: 0, limit: 25 },
  },
};

let renderFn = () => {};
let queued = false;
export const setRenderer = (fn) => { renderFn = fn; };
export function render() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; renderFn(); });
}

let toastSeq = 0;
let setupChecked = false;
export function toast(text, kind = 'info', action = null) {
  const t = { id: ++toastSeq, text, kind, action };
  store.toasts = [...store.toasts.slice(-3), t];
  render();
  setTimeout(() => dismiss(t.id), kind === 'error' ? 9000 : action ? 7000 : 4200);
}
export function dismiss(id) { store.toasts = store.toasts.filter((t) => t.id !== id); render(); }

// Run an API action: tracks busy state, toasts failures, refreshes state after success.
export async function act(id, fn, { ok, undo, refresh = true } = {}) {
  if (store.busy.has(id)) return null;
  store.busy.add(id); render();
  try {
    const r = await fn();
    if (ok) toast(typeof ok === 'function' ? ok(r) : ok, 'ok', undo || null);
    if (refresh) await poll();
    return { r };
  } catch (e) {
    toast(e.message || 'Erreur', 'error');
    return null;
  } finally {
    store.busy.delete(id); render();
  }
}

export async function poll() {
  try {
    store.data = await get('/api/state');
    if (!setupChecked) { setupChecked = true; if (!store.data.setup_complete) location.hash = '#/start'; }
    store.offline = false;
    if (store.route === 'stats') await loadStats();
    if (store.route === 'outliers') store.outliers = await get('/api/outliers');
  } catch (e) {
    store.offline = true;
    if (!store.data) store.error = e.message;
  }
  render();
}

export async function loadRouteData(route) {
  try {
    if (route === 'stats') await loadStats();
    if (route === 'outliers') store.outliers = await get('/api/outliers');
  } catch (e) { toast(e.message, 'error'); }
  render();
}

export const clipAction = (id, body) => post(`/api/clips/${id}`, body);

export const statsFilters = () => Object.fromEntries(['platform', 'channel', 'days', 'metric', 'minimum'].map(k => [k, store.ui.stats[k]]));
let statsRequest = 0;
export async function loadStats() {
  const request = ++statsRequest;
  const query = new URLSearchParams(statsFilters()).toString();
  store.statsLoading = true; store.statsError = null; render();
  try {
    const result = await get(`/api/performance?${query}`);
    if (request === statsRequest) store.stats = result;
  } catch (e) { if (request === statsRequest) store.statsError = e.message; }
  finally { if (request === statsRequest) { store.statsLoading = false; render(); } }
}

// Derived numbers used by sidebar and Today.
export function derive(d) {
  const clips = d.clips;
  const n = (s) => clips.filter((c) => c.status === s).length;
  const pubs = d.publications;
  const now = Date.now();
  return {
    review: n('review'), qaFailed: n('qa_failed'), approved: n('approved'),
    pubErrors: pubs.filter((p) => p.state === 'error').length,
    upcoming: pubs.filter((p) => ['planned', 'queued', 'draft'].includes(p.state) && new Date(p.scheduled_at).getTime() >= now - 3600e3)
      .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)),
    sourcesActive: d.sources.filter((s) => !['mined', 'failed'].includes(s.status)).length,
    newIdeas: d.ideas.filter((i) => i.status === 'new').length,
  };
}

export const go = (route) => { location.hash = `#/${route}`; };
