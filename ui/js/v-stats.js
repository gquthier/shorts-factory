import { h } from './dom.js';
import { store, act, render, loadStats, statsFilters, clipAction, go } from './state.js';
import { post } from './api.js';
import { card, pageHead, empty, loading, bar, btn, badge } from './ui.js';
import { humanize, num } from './util.js';

const LABELS = { views: 'Vues', impressions: 'Impressions', reach: 'Portée', interactions: 'Interactions', engagement: 'Engagement / vues', likes: 'Likes', comments: 'Commentaires', sends: 'Partages', saves: 'Enregistrements', avg_watch_s: 'Visionnage moyen' };
const PLATFORMS = { youtube: 'YouTube', instagram: 'Instagram', 'instagram-facebook': 'Instagram', tiktok: 'TikTok', facebook: 'Facebook' };
const FORMATS = { methode: 'Méthode / tutoriel', histoire: 'Histoire', erreur: 'Erreur à éviter', chiffre: 'Chiffre / preuve', affirmation: 'Prise de position', reponse: 'Question / réponse' };
const format = value => FORMATS[value] || humanize(value);
const measure = (v, metric, compact = false) => v == null ? '—' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: ['engagement', 'avg_watch_s'].includes(metric) ? 1 : compact ? 1 : 0, notation: compact && v >= 10000 ? 'compact' : 'standard' }).format(v) + (metric === 'engagement' ? ' %' : metric === 'avg_watch_s' ? ' s' : '');
const date = v => v ? new Date(/T/.test(v) ? v : v.replace(' ', 'T') + (v.length === 10 ? 'T00:00:00Z' : 'Z')).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Date inconnue';
const scopeKey = f => JSON.stringify(['platform', 'channel', 'days', 'metric', 'minimum'].map(k => String(f[k])));

function change(key, value) {
  store.ui.stats[key] = value; store.ui.stats.limit = 25;
  if (key === 'platform') store.ui.stats.channel = '';
  void loadStats();
}
function select(label, key, options) {
  return h('label', { class: 'stat-filter' }, h('span', null, label), h('select', { 'aria-label': label, value: store.ui.stats[key], onchange: e => change(key, e.target.value) }, options.map(([value, name]) => h('option', { key: value, value }, name))));
}
function comparisons(title, rows, metric, kind) {
  const max = Math.max(...rows.map(r => r.median || 0), 1);
  return card(title, rows.length ? h('div', { class: 'tablewrap' }, h('table', null,
    h('thead', null, h('tr', null, h('th', null, kind === 'channel' ? 'Chaîne' : 'À comparer'), h('th', { class: 'r' }, 'Mesurées'), h('th', { class: 'r' }, 'Médiane'))),
    h('tbody', null, rows.map(r => h('tr', { key: r.name },
      h('td', null, h('b', null, kind === 'format' ? format(r.label) : humanize(r.label)), h('div', { class: 'muted sm' }, `${r.clips} vidéo${r.clips > 1 ? 's' : ''} · ${r.count} publication${r.count > 1 ? 's' : ''}`)),
      h('td', { class: 'r tnum muted' }, `${r.covered}/${r.count}`),
      h('td', { class: 'r' }, h('div', { class: 'stat-result' }, h('b', { class: 'tnum' }, measure(r.median, metric)), r.median != null ? bar(r.median, max) : null))))))) : empty('Pas encore de comparaison', 'Les données apparaîtront après la synchronisation.'), { right: badge(LABELS[metric]) });
}
function insights(s, generating) {
  const covered = s.totals[s.filters.metric].covered;
  return card(null, h('div', { class: 'stat-next' },
    h('div', { class: 'stat-next-head' }, h('div', null, h('span', { class: 'section-l' }, 'Les prochains Reels'), h('h2', null, s.insights.length ? 'Des pistes à développer' : 'Construire ton prochain test'),
      h('p', { class: 'muted mt' }, s.insights.length ? 'Les sujets et formats qui dépassent les autres vidéos de la même chaîne.' : covered ? 'Tes premières données servent déjà à proposer des variantes. Il faut encore du recul pour identifier des tendances.' : 'Choisis une métrique disponible pour nourrir les prochaines idées.')),
      btn(generating ? 'Écriture en cours…' : 'Générer 10 idées avec ces données', { kind: 'primary', icon: 'plus', disabled: !covered || generating, busy: store.busy.has('stats-ideas'), onclick: async () => {
        const result = await act('stats-ideas', () => post('/api/ideas/generate', { count: 10, performance: statsFilters() }), { ok: 'Écriture lancée avec les données et les filtres sélectionnés.' });
        if (result) go('ideas');
      } })),
    s.insights.length ? h('div', { class: 'stat-signals' }, s.insights.map((i, index) => h('div', { class: 'stat-signal', key: index },
      h('div', { class: 'row between' }, badge(i.dimension === 'topic' ? 'Sujet' : 'Format', 'accent'), h('b', { class: 'stat-lift' }, `+${Math.round(i.lift)} %`)),
      h('h3', null, i.dimension === 'format' ? format(i.name) : i.name),
      h('p', null, `${measure(i.median, s.filters.metric)} de médiane · ${i.clips} vidéos`),
      h('p', { class: 'muted sm' }, `${i.channel} · ${PLATFORMS[i.platform] || i.platform} · autres vidéos : ${measure(i.baseline, s.filters.metric)}`),
      h('div', { class: 'muted sm mt' }, 'Piste à confirmer avec de nouvelles variantes.')))) : null,
    h('p', { class: 'muted sm mt' }, 'Les idées reprennent les sujets, formats et hooks observés, avec de nouveaux angles. Tu les retrouves dans Idées.')),
  { cls: 'stat-learning' });
}
function videos(s) {
  const u = store.ui.stats;
  const columns = [...new Set([u.metric, 'views', 'impressions', 'interactions', 'sends', 'saves'])];
  return card(`Publications · ${s.count}`, h('div', null,
    h('div', { class: 'tablewrap' }, h('table', { class: 'stat-videos' },
      h('thead', null, h('tr', null, h('th', null, 'Vidéo / chaîne'), h('th', null, 'Format / sujet'), columns.map(k => h('th', { key: k, class: 'r' }, h('button', { class: `sort ${u.metric === k ? 'on' : ''}`, onclick: () => change('metric', k), 'aria-label': `Trier par ${LABELS[k]}` }, LABELS[k], u.metric === k ? ' ↓' : ''))))),
      h('tbody', null, s.top.slice(0, u.limit).map(r => h('tr', { key: r.id },
        h('td', { class: 'stat-video-title' }, /^https?:\/\//.test(r.release_url || '') ? h('a', { href: r.release_url, target: '_blank', rel: 'noopener noreferrer', class: 'lnk' }, r.title || r.hook || r.clip_id) : h('b', null, r.title || r.hook || r.clip_id),
          h('div', { class: 'muted sm mt' }, `${PLATFORMS[r.platform] || r.platform} · ${r.account}`), h('div', { class: 'muted sm' }, date(r.published_at)),
          h('div', { class: 'muted sm', title: 'Dernier relevé communiqué par le réseau' }, r.measured_at ? `Relevé : ${date(r.measured_at)}` : 'Statistiques en attente')),
        h('td', null, h('div', { class: 'sm mb' }, format(r.format || 'Non classé')),
          h('select', { class: 'stat-topic', value: r.topic_manual ? r.topic : '', 'aria-label': `Sujet de ${r.title || r.hook || r.clip_id}`, disabled: store.busy.has(`topic:${r.clip_id}`), onchange: e => {
            const topic = e.target.value || null;
            void act(`topic:${r.clip_id}`, () => clipAction(r.clip_id, { action: 'topic', topic }), { ok: 'Sujet mis à jour pour cette vidéo.' });
          } }, h('option', { value: '' }, r.topic_manual ? 'Détection automatique' : `${r.topic} (auto)`), s.topics.map(topic => h('option', { key: topic, value: topic }, topic)))),
        columns.map(k => h('td', { key: k, class: `r tnum ${u.metric === k ? 'stat-selected' : ''}`, title: r[k] == null ? 'Non communiqué par le réseau' : LABELS[k] }, measure(r[k], k)))))))),
    s.count > u.limit ? h('div', { class: 'row end mt' }, btn(`Afficher plus (${s.count - u.limit})`, { onclick: () => { u.limit += 50; render(); } })) : null), { right: badge(`Tri : ${LABELS[u.metric]}`) });
}

export function stats() {
  const s = store.stats, u = store.ui.stats, d = store.data;
  const sync = d?.running.some(j => j.type === 'sync') || d?.jobs.some(j => j.type === 'sync' && ['queued', 'running'].includes(j.status) && j.n);
  const generating = d?.running.some(j => j.type === 'ideas') || d?.jobs.some(j => j.type === 'ideas' && ['queued', 'running'].includes(j.status) && j.n);
  const channels = s?.channels || (d?.channels || []).map(c => ({ ...c, platform: c.provider }));
  const matching = channels.filter(c => !u.platform || c.platform === u.platform || u.platform === 'instagram' && c.platform === 'instagram-facebook');
  const current = s && scopeKey(s.filters) === scopeKey(statsFilters());
  const filters = h('div', { class: 'stat-filters' },
    select('Réseau', 'platform', [['', 'Tous les réseaux'], ['youtube', 'YouTube'], ['instagram', 'Instagram'], ['tiktok', 'TikTok'], ['facebook', 'Facebook']]),
    select('Chaîne', 'channel', [['', 'Toutes les chaînes'], ...matching.map(c => [c.id, `${c.name} · ${PLATFORMS[c.platform] || c.platform}`])]),
    select('Publications', 'days', [[7, '7 derniers jours'], [30, '30 derniers jours'], [90, '90 derniers jours'], [0, 'Tout l’historique']]),
    select('Comparer selon', 'metric', Object.entries(LABELS)),
    h('label', { class: 'stat-filter stat-min' }, h('span', null, 'Minimum'), h('input', { type: 'number', min: 0, step: 'any', 'aria-label': 'Minimum de la métrique sélectionnée', value: u.minimum || '', placeholder: 'Sans minimum', onchange: e => change('minimum', Math.max(0, Number(e.target.value) || 0)) })));
  const head = pageHead('Performance', 'Comprendre ce qui marche. S’en servir pour les prochains Reels.', [btn(sync ? 'Synchronisation…' : 'Actualiser les statistiques', { icon: 'refresh', disabled: sync, busy: store.busy.has('stats-sync'), onclick: () => act('stats-sync', () => post('/api/sync'), { ok: 'Récupération des statistiques lancée.' }) })]);
  const content = store.statsError ? card(null, empty('Statistiques indisponibles', store.statsError, btn('Réessayer', { onclick: () => loadStats() }))) : !current ? loading(4) : h('div', null,
    h('div', { class: 'stat-kpis' }, ['views', 'impressions', 'interactions', 'engagement', 'sends', 'saves'].map(k => h('button', { key: k, class: `stat-kpi ${u.metric === k ? 'on' : ''}`, 'aria-pressed': u.metric === k, onclick: () => change('metric', k) },
      h('span', { class: 'muted sm' }, LABELS[k]), h('strong', { class: 'tnum', title: measure(s.totals[k].value, k) }, measure(s.totals[k].value, k, true)),
      h('span', { class: 'muted sm' }, `${s.totals[k].covered}/${s.count} publications mesurées`)))),
    h('div', { class: 'stat-meta muted sm' }, h('span', null, `${s.count} publications · ${s.clips} vidéos distinctes`), h('span', null, s.latest ? `Dernières données : ${date(s.latest)}` : 'En attente des premières données')),
    !s.count ? card(null, empty('Aucune publication pour ces filtres', 'Élargis la période ou sélectionne une autre chaîne.', btn('Réinitialiser les filtres', { onclick: () => { Object.assign(u, { platform: '', channel: '', days: 0, minimum: 0 }); void loadStats(); } }))) : null,
    insights(s, generating),
    s.count ? h('div', null,
      h('div', { class: 'row mb' }, h('span', { class: 'muted sm' }, 'Comparer les créations :'), h('div', { class: 'pills' }, [['format', 'Formats'], ['template', 'Habillages'], ['hook', 'Hooks']].map(([key, name]) => h('button', { key, class: `pill ${(u.group || 'format') === key ? 'on' : ''}`, 'aria-pressed': (u.group || 'format') === key, onclick: () => { u.group = key; render(); } }, name)))),
      h('div', { class: 'cols2' }, comparisons(u.group === 'template' ? 'Habillages qui fonctionnent' : u.group === 'hook' ? 'Mécaniques de hook' : 'Formats qui fonctionnent', u.group === 'template' ? s.byTemplate : u.group === 'hook' ? s.byHook : s.byFormat, u.metric, u.group || 'format'), comparisons('Sujets qui fonctionnent', s.byTopic, u.metric, 'topic')),
      !u.channel ? comparisons('Résultats par chaîne', s.byChannel, u.metric, 'channel') : null,
      videos(s)) : null,
    h('details', { class: 'panel stat-method' }, h('summary', null, 'Comment lire ces chiffres ?'),
      h('p', null, 'Les compteurs sont cumulatifs : seul le dernier relevé de chaque publication est compté. La période filtre la date de publication (la date programmée sert de repli). Il ne s’agit pas des vues gagnées pendant cette période. Les imports sans date de publication figurent dans « Tout l’historique ».'),
      h('p', null, 'Interactions = likes + commentaires + partages. Les enregistrements sont séparés. Engagement = interactions ÷ vues, sur les seules publications disposant de ces deux données. « — » signifie non communiqué, jamais zéro. La portée additionnée n’est pas une audience unique entre vidéos.'),
      h('p', null, 'Les tableaux comparent les médianes par publication : une vidéo virale isolée pèse moins qu’avec une moyenne. Les vues restent sensibles à l’âge des vidéos et à la taille des chaînes. Les pistes comparent une même chaîne, après 72 h, avec au moins 3 vidéos distinctes dans le groupe et 3 dans les autres groupes, et un écart d’au moins 20 %. Ce sont des pistes à tester, pas une preuve statistique.'),
      h('p', null, 'Format = type éditorial ; habillage = montage visuel. Les sujets automatiques sont estimés à partir des titres et hooks. Corrige-les dans le tableau pour améliorer les prochaines idées. Seules les publications suivies dans cette application sont analysées.')));
  return h('div', { key: 'stats', class: 'page stats-page' }, head, filters, content);
}
