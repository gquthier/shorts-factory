// Tiny virtual-node layer: views describe the DOM, patch() updates it in place
// (keyed diff) so playing videos, focus, open panels and scroll survive every poll.

const SVG = new Set(['svg', 'path', 'circle', 'rect', 'line', 'polyline', 'g']);
const PROPS = new Set(['checked', 'disabled', 'indeterminate', 'selected', 'open']);

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function h(tag, attrs, ...kids) {
  const a = attrs && typeof attrs === 'object' && !Array.isArray(attrs) && !attrs.tag ? attrs : null;
  if (!a && attrs !== null && attrs !== undefined) kids.unshift(attrs);
  const flat = [];
  const push = (k) => {
    if (Array.isArray(k)) k.forEach(push);
    else if (k !== null && k !== undefined && k !== false && k !== true) flat.push(typeof k === 'object' ? k : { text: String(k) });
  };
  kids.forEach(push);
  return { tag, attrs: a || {}, key: a?.key, kids: flat };
}

function create(v, svg) {
  if (v.text !== undefined) return document.createTextNode(v.text);
  const isSvg = svg || v.tag === 'svg';
  const el = isSvg || SVG.has(v.tag) ? document.createElementNS('http://www.w3.org/2000/svg', v.tag) : document.createElement(v.tag);
  el._a = {};
  return el;
}

function setAttrs(el, attrs) {
  const prev = el._a;
  for (const k of Object.keys(prev)) if (!(k in attrs) && k !== 'key') unset(el, k);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'key' || prev[k] === v && !k.startsWith('on')) continue;
    if (k.startsWith('on')) { el[k.toLowerCase()] = v; }
    else if (k === 'value' && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) applyValue(el, v);
    else if (PROPS.has(k)) { if (el[k] !== !!v) el[k] = !!v; }
    else if (k === 'class') { if (el.namespaceURI.endsWith('svg')) el.setAttribute('class', v); else el.className = v; }
    else if (k === 'style') el.style.cssText = v;
    else if (v === false || v === null || v === undefined) el.removeAttribute(k);
    else el.setAttribute(k, v === true ? '' : v);
  }
  el._a = attrs;
}

function unset(el, k) {
  if (k.startsWith('on')) el[k.toLowerCase()] = null;
  else if (PROPS.has(k)) el[k] = false;
  else if (k === 'class') el.removeAttribute('class');
  else if (k === 'style') el.style.cssText = '';
  else if (k !== 'value') el.removeAttribute(k);
}

// Never overwrite what the user is typing or has edited.
function applyValue(el, v) {
  const val = v ?? '';
  if (el === document.activeElement || el._dirty) return;
  if (el.value !== String(val)) el.value = val;
}

export const markClean = (el) => { if (el) el._dirty = false; };
document.addEventListener('input', (e) => { if (e.target) e.target._dirty = true; }, true);

export function patch(parent, vnodes, svg = false) {
  vnodes = vnodes.filter(Boolean);
  const old = Array.from(parent.childNodes);
  const keyed = new Map();
  for (const n of old) if (n._key !== undefined) keyed.set(n._key, n);
  const used = new Set();
  const plan = [];
  let cursor = 0;
  for (const v of vnodes) {
    let node = null;
    if (v.key !== undefined) {
      const c = keyed.get(v.key);
      if (c && c.nodeName.toLowerCase() === v.tag.toLowerCase() && !used.has(c)) node = c;
    } else {
      while (cursor < old.length) {
        const c = old[cursor++];
        if (used.has(c) || c._key !== undefined) continue;
        const same = v.text !== undefined ? c.nodeType === 3 : c.nodeType === 1 && c.nodeName.toLowerCase() === v.tag.toLowerCase();
        if (same) { node = c; break; }
      }
    }
    if (node) used.add(node);
    plan.push([v, node]);
  }
  for (const n of old) if (!used.has(n)) n.remove();
  plan.forEach(([v, existing], i) => {
    let node = existing;
    if (v.text !== undefined) {
      if (!node) node = create(v);
      else if (node.data !== v.text) node.data = v.text;
    } else {
      if (!node) node = create(v, svg);
      node._key = v.key;
      setAttrs(node, v.attrs);
      patch(node, v.kids, svg || v.tag === 'svg');
      // <select> value must be applied after its options exist.
      if (v.tag === 'select' && 'value' in v.attrs) applyValue(node, v.attrs.value);
    }
    if (parent.childNodes[i] !== node) parent.insertBefore(node, parent.childNodes[i] || null);
  });
}
