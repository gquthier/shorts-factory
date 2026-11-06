import { h } from './dom.js';

const P = {
  today: 'M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4M12 8a4 4 0 100 8 4 4 0 000-8z',
  sources: 'M4 5h16v10H4zM8 19h8M12 15v4',
  review: 'M5 3h14v18l-7-4-7 4zM9 9l2 2 4-4',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  accounts: 'M12 11a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  stats: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
  ideas: 'M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0012 3z',
  outliers: 'M3 17l6-6 4 4 8-9M15 6h6v6',
  settings: 'M4 7h10M18 7h2M4 17h2M10 17h10M16 4v6M8 14v6',
  check: 'M5 12l5 5 9-10',
  x: 'M6 6l12 12M18 6L6 18',
  play: 'M7 4l13 8-13 8z',
  alert: 'M12 9v4M12 17h.01M10.3 4l-8 14a2 2 0 001.7 3h16a2 2 0 001.7-3l-8-14a2 2 0 00-3.4 0z',
  refresh: 'M20 11a8 8 0 00-14-4L4 9M4 4v5h5M4 13a8 8 0 0014 4l2-2M20 20v-5h-5',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3A4 4 0 0011 18.7l1-1',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  chevron: 'M9 6l6 6-6 6',
  left: 'M15 6l-6 6 6 6',
  right: 'M9 6l6 6-6 6',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3',
  plus: 'M12 5v14M5 12h14',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 018 0v3',
};

export const icon = (name, size = 16) => h('svg', { class: 'ico', width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' }, h('path', { d: P[name] || P.alert }));
