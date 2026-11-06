// Small shared components (vnode builders).
import { h } from './dom.js';
import { icon } from './icons.js';

export const badge = (text, tone = 'mute', title) => h('span', { class: `badge ${tone}`, title }, text);

export const btn = (label, opts = {}) => h('button', {
  type: 'button', class: `btn ${opts.kind || ''} ${opts.small ? 'sm' : ''}`, disabled: !!opts.disabled || !!opts.busy,
  onclick: opts.onclick, title: opts.title, key: opts.key, 'aria-busy': opts.busy ? 'true' : null, 'data-act': opts.act,
}, opts.icon ? icon(opts.icon, 14) : null, label ? h('span', null, label) : null);

export const iconBtn = (name, label, onclick, extra = {}) => h('button', { type: 'button', class: 'iconbtn', 'aria-label': label, title: label, onclick, ...extra }, icon(name, 15));

export const empty = (title, text, action) => h('div', { class: 'empty' }, h('div', { class: 'empty-t' }, title), text ? h('div', { class: 'empty-s' }, text) : null, action || null);

export const loading = (rows = 3) => h('div', { class: 'skel-wrap', 'aria-busy': 'true', 'aria-label': 'Chargement' }, Array.from({ length: rows }, (_, i) => h('div', { class: 'skel', key: i })));

export const pageHead = (title, sub, actions) => h('div', { class: 'pagehead' },
  h('div', null, h('h1', null, title), sub ? h('p', { class: 'sub' }, sub) : null),
  actions ? h('div', { class: 'row' }, actions) : null);

export const card = (title, body, { right, key, cls } = {}) => h('section', { class: `panel ${cls || ''}`, key },
  title ? h('header', { class: 'panel-h' }, h('h2', null, title), right || null) : null, body);

export function bar(value, max, tone = 'accent') {
  const w = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': Math.round(value), 'aria-valuemax': max }, h('i', { class: tone, style: `width:${w}%` }));
}

export const toggle = (checked, onchange, label, disabled = false) => h('button', {
  type: 'button', class: 'switch', role: 'switch', 'aria-checked': checked ? 'true' : 'false', 'aria-label': label, disabled, onclick: () => onchange(!checked),
}, h('i'));

export const kbd = (k) => h('kbd', null, k);

export const stateTone = { planned: 'blue', queued: 'amber', draft: 'violet', published: 'ok', error: 'bad' };
