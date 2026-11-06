// How well a clip has aged on the day it would be posted. A launch video from months ago sounds wrong today; a sales principle does not. Pure, unit tested.

export type ShelfLife = 'news' | 'trend' | 'evergreen';

// Launches and hot tools: stale fast.
const NEWS = /open[- ]?cl[ao]w?\b|openclo\b|claude\s?claw|clawd|clawg|\bherm[eè]s\b|\bmanus\b|\bkimi\b|\bqwen\b|\bdeepseek\b|\bmistral\b|gpt[- ]?\d|\bopus\s?\d|\bsonnet\s?\d|\bgemini\s?\d|\bgrok\s?\d|\bveo\s?\d|\bsora\b|vient(s)? de (sortir|lancer|tuer|publier)|viens de (sortir|lancer)|nouveau modèle|nouvelle version|mise à jour|cette semaine|hier soir|chatgpt ads/i;
// Current tools and tactics: stale slowly.
const TREND = /claude\s?code|cloud\s?code|\bn8n\b|\bmcp\b|\bskills?\b|\bagents?\b|\bchatgpt\b|\bopenai\b|\banthropic\b|algorithme|\bgeo\b|andromeda/i;

const RANK: Record<ShelfLife, number> = { evergreen: 0, trend: 1, news: 2 };

/** The stricter of what the text shows and what the writer judged. */
export function shelfLife(text: string, judged?: string | null): ShelfLife {
  const found: ShelfLife = NEWS.test(text) ? 'news' : TREND.test(text) ? 'trend' : 'evergreen';
  const other = judged === 'news' || judged === 'trend' || judged === 'evergreen' ? judged : 'evergreen';
  return RANK[other] > RANK[found] ? other : found;
}

export const STALE_AFTER_DAYS: Record<ShelfLife, number> = { news: 21, trend: 120, evergreen: 540 };

export const ageInDays = (publishedAt: string | null | undefined, now: Date): number | null => {
  if (!publishedAt) return null;
  const [y, m, d] = publishedAt.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return Math.max(0, Math.floor((now.getTime() - new Date(y, m - 1, d).getTime()) / 86_400_000));
};

export interface Freshness { shelf: ShelfLife; age: number | null; stale: boolean }

/** Unknown age counts as fresh: better to post a clip than to bury it for a missing date. */
export function freshness(text: string, judged: string | null | undefined, publishedAt: string | null | undefined, now: Date): Freshness {
  const shelf = shelfLife(text, judged);
  const age = ageInDays(publishedAt, now);
  return { shelf, age, stale: age !== null && age > STALE_AFTER_DAYS[shelf] };
}

/** YouTube's YYYYMMDD to YYYY-MM-DD. */
export const parseUploadDate = (s: string | undefined): string | null => (s && /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);
