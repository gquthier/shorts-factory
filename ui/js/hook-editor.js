// Hook editor: change the words, see the template draw them at once, then apply to remake the video.
import { h } from './dom.js';
import { store, render } from './state.js';
import { btn } from './ui.js';
import { rerender } from './review-actions.js';

const r = () => store.ui.review;
const timers = {};

async function load(c, text) {
  try {
    const res = await fetch(`/api/clips/${encodeURIComponent(c.id)}/hook-preview?hook=${encodeURIComponent(text)}`);
    if (!res.ok) return;
    const html = await res.text();
    r().preview = { ...r().preview, [c.id]: { template: c.template, html } };
    render();
  } catch { /* the preview is a convenience: the editor still works without it */ }
}

function schedule(c, text, delay = 90) {
  clearTimeout(timers[c.id]);
  timers[c.id] = setTimeout(() => load(c, text), delay);
}

/** Puts a text in the editor: typed by him, or one of the written hooks to adjust. */
export function setHookDraft(c, text) {
  r().hookEdit = { ...r().hookEdit, [c.id]: text };
  schedule(c, text);
  render();
}

export function hookEditor(c) {
  const draft = r().hookEdit?.[c.id] ?? c.hook ?? '';
  const prev = r().preview?.[c.id];
  if (!prev || prev.template !== c.template) schedule(c, draft, 0);
  const dirty = draft.trim() !== (c.hook ?? '').trim();
  const busy = store.busy.has(`clip:${c.id}:rerender`);
  const apply = () => rerender(c, { hook: draft.trim() }, 'Montage relancé avec ton hook').then((ok) => {
    if (!ok) return;
    const { [c.id]: _, ...rest } = r().hookEdit ?? {};
    r().hookEdit = rest;
    render();
  });
  return h('div', { class: 'hook-ed' },
    h('div', { class: 'hook-prev', 'aria-hidden': 'true' }, prev ? h('iframe', { key: 'f', title: 'Aperçu du hook', srcdoc: prev.html, tabindex: '-1' }) : null),
    h('div', { class: 'stack-s' },
      h('textarea', { rows: 3, maxlength: 160, value: draft, 'aria-label': 'Hook', oninput: (e) => setHookDraft(c, e.target.value) }),
      h('p', { class: 'muted sm' }, 'L\'aperçu suit ce que tu tapes. Format cinéma : un *mot* entre étoiles ressort.'),
      h('div', { class: 'row' },
        btn('Appliquer', { small: true, kind: dirty ? 'primary' : '', disabled: !dirty || draft.trim().length < 3, busy, onclick: apply }),
        dirty ? btn('Annuler', { small: true, onclick: () => setHookDraft(c, c.hook ?? '') }) : null)));
}
