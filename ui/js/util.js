// Labels, formatters and tiny helpers shared by every view.

export const JOB_LABEL = { ingest: 'Téléchargement', transcribe: 'Transcription', mine: 'Recherche des moments', hook: 'Écriture des hooks', render: 'Montage', qa: 'Contrôle qualité', publish: 'Envoi à TryPost', sync: 'Synchro', ideas: 'Écriture des scripts' };
export const KINDS = { youtube: 'Vidéo YouTube', live: 'Live YouTube', upload: 'Vidéo à moi', masterclass: 'Masterclass', qa: 'Q&A' };
export const SOURCE_STATE = { new: 'En attente', ingested: 'Téléchargée', transcribed: 'Transcrite', mined: 'Analysée', failed: 'Échec' };
export const CLIP_STATUS = { long: 'Trop long', candidate: 'À écrire', hooked: 'En montage', rendered: 'Contrôle', qa_failed: 'QA en échec', review: 'À valider', approved: 'Validé', scheduled: 'Programmé', exported: 'Exporté', rejected: 'Rejeté', weak: 'Hook faible', failed: 'Échec' };
export const PUB_STATE = { planned: 'Planifié', queued: 'En file', draft: 'Brouillon', published: 'Publié', error: 'Erreur' };
export const PROVIDERS = { instagram: 'Instagram', 'instagram-standalone': 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', facebook: 'Facebook', linkedin: 'LinkedIn', x: 'X', threads: 'Threads' };

export const VIDEO_STATUSES = new Set(['rendered', 'qa_failed', 'review', 'approved', 'scheduled', 'exported', 'rejected']);

export const humanize = (s) => { const t = String(s ?? '').replace(/[-_]/g, ' ').trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
export const pct = (n) => `${Math.round(n * 100)} %`;
export const num = (n) => (n === null || n === undefined || n === '' ? '–' : Number(n).toLocaleString('fr-FR'));
export const compact = (n) => (n === null || n === undefined ? '–' : new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 }).format(n));
export const provider = (p) => PROVIDERS[p] || humanize(p);

export const dur = (s) => { const t = Math.round(s || 0); return t >= 60 ? `${Math.floor(t / 60)} min ${String(t % 60).padStart(2, '0')}` : `${t} s`; };
export const mins = (s) => (s ? `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')}` : '');

// SQLite timestamps ("2026-11-05 12:13:45") are UTC.
export const fromSql = (s) => new Date(String(s).replace(' ', 'T') + 'Z');
export function ago(d) {
  const sec = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (sec < 60) return "à l'instant";
  if (sec < 3600) return `il y a ${Math.floor(sec / 60)} min`;
  if (sec < 86400) return `il y a ${Math.floor(sec / 3600)} h`;
  return `il y a ${Math.floor(sec / 86400)} j`;
}

// Local-time day key (never parse YYYY-MM-DD as UTC).
export const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const timeOf = (d) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
export const startOfWeek = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export const wordCount = (t) => (String(t || '').match(/\S+/g) || []).length;
// ~2.7 words per second for read-aloud French short-form delivery.
export const readSeconds = (t) => Math.round(wordCount(t) / 2.7);

export const clipTitle = (c) => c.hook || c.title || c.id;
