// A note per clip: how likely it is to travel, from what the outlier study showed and what the accounts measure later.
// This is an estimate to rank clips, not a prediction of views. Pure, unit tested.

export interface OutlierRow { ratio: number; hook_type?: string; language?: string }
export interface ClipSignals {
  hookScore: number;       // 0-100, from the judge
  standalone: number;      // 0-10, from the miner
  hookType: string | null;
  text: string;            // hook + transcript
  seconds: number;
  qaStatus: string | null;
  tics: number;
}

// Subjects that overperformed in the outlier study, in the creator's audience. Regex on hook and transcript.
const TOPICS: { label: string; re: RegExp; weight: number }[] = [];

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1] ?? 0; };

/** 0 to 1 per hook type, from the median outlier ratio. French rows count double: that is his market. */
export function hookTypeWeights(rows: OutlierRow[]): Record<string, number> {
  const byType = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.hook_type) continue;
    const list = byType.get(r.hook_type) ?? [];
    byType.set(r.hook_type, r.language === 'fr' ? [...list, r.ratio, r.ratio] : [...list, r.ratio]);
  }
  const logs = [...byType].map(([t, v]) => [t, Math.log(1 + median(v))] as const);
  const max = Math.max(1e-6, ...logs.map(([, v]) => v));
  return Object.fromEntries(logs.map(([t, v]) => [t, +(v / max).toFixed(3)]));
}

// Hook types named differently in the playbook and in the study.
const ALIASES: Record<string, string> = { 'tout-le-monde': 'interdit', 'plus-besoin': 'prix-assume', comparatif: 'comparatif-bon-nul', degradation: 'consequence' };

export interface ViralNote { score: number; why: string[] }

export function viralNote(c: ClipSignals, weights: Record<string, number>, measured: Record<string, number> = {}): ViralNote {
  const why: string[] = [];
  const topics = TOPICS.filter((t) => t.re.test(c.text));
  const topic = topics.length ? Math.min(1, Math.max(...topics.map((t) => t.weight)) + 0.1 * (topics.length - 1)) : 0.5;
  if (topics.length) why.push(`Sujet porteur : ${topics.slice(0, 3).map((t) => t.label).join(', ')}`);
  else why.push('Sujet : pas encore de données propres à cette audience');
  const key = ALIASES[c.hookType ?? ''] ?? c.hookType ?? '';
  // Once his own accounts have data on a hook type, it replaces the study's figure.
  const type = measured[key] ?? weights[key] ?? 0.4;
  if (type >= 0.6) why.push(`Hook « ${c.hookType} » : fort dans ${measured[key] !== undefined ? 'tes stats' : "l'étude"}`);
  const duration = c.seconds < 10 ? 0.4 : c.seconds <= 45 ? 1 : c.seconds <= 60 ? 0.6 : 0.2;
  if (c.seconds > 45) why.push(`Long : ${Math.round(c.seconds)} s`);
  let score = (c.hookScore / 100) * 40 + (c.standalone / 10) * 20 + topic * 20 + type * 10 + duration * 10;
  if (c.qaStatus === 'warn') { score -= 5; why.push('Alerte qualité'); }
  if (c.tics >= 3) { score -= 5; why.push(`${c.tics} tics restants`); }
  if (c.qaStatus === 'fail') { score = Math.min(score, 30); why.push('Échec du contrôle qualité'); }
  return { score: Math.max(0, Math.min(100, Math.round(score))), why };
}

/** Relative performance per hook type on his own accounts, once a type has enough measured clips. */
export function measuredWeights(rows: { type: string; n: number; views: number }[], minClips = 5): Record<string, number> {
  const usable = rows.filter((r) => r.n >= minClips && r.views > 0);
  const max = Math.max(1, ...usable.map((r) => r.views));
  return Object.fromEntries(usable.map((r) => [r.type, +(Math.log(1 + r.views) / Math.log(1 + max)).toFixed(3)]));
}
