import type { DatabaseSync } from 'node:sqlite';
import { buildPerformance, classifyTopic, type PerformanceRow } from './performance.ts';

export function readPerformance(db: DatabaseSync, filters: Parameters<typeof buildPerformance>[1] = {}) {
  const columns = `c.id clip_id, c.title, c.hook, c.hook_type, c.template, c.category format, c.performance_topic,
    m.measured_at, m.views, m.impressions, m.reach, m.likes, m.comments, m.sends, m.saves, m.avg_watch_s`;
  const rows = db.prepare(`
    SELECT p.id, p.channel_id, ch.name account, ch.provider platform, COALESCE(p.published_at, p.scheduled_at) published_at, p.release_url, ${columns}
      FROM publications p JOIN channels ch ON ch.id = p.channel_id JOIN clips c ON c.id = p.clip_id
      LEFT JOIN latest_metrics m ON m.clip_id = p.clip_id AND m.channel_id = p.channel_id AND m.platform = ch.provider
      WHERE p.state = 'published'
    UNION ALL
    SELECT 'import:' || c.id || ':' || COALESCE(m.channel_id, m.account) || ':' || m.platform id,
      COALESCE(m.channel_id, 'legacy:' || m.platform || ':' || m.account) channel_id,
      COALESCE(ch.name, m.account) account, m.platform, NULL published_at, NULL release_url, ${columns}
      FROM latest_metrics m JOIN clips c ON c.id = m.clip_id LEFT JOIN channels ch ON ch.id = m.channel_id
      WHERE NOT EXISTS (SELECT 1 FROM publications p WHERE p.clip_id = m.clip_id AND p.channel_id = m.channel_id)
  `).all() as unknown as (Omit<PerformanceRow, 'topic' | 'topic_manual'> & { performance_topic: string | null })[];
  const s = buildPerformance(rows.map(r => ({ ...r, topic: r.performance_topic || classifyTopic(`${r.title ?? ''} ${r.hook ?? ''}`), topic_manual: !!r.performance_topic })), filters);
  const connected = db.prepare('SELECT id, name, provider platform FROM channels ORDER BY provider, name').all() as { id: string; name: string; platform: string }[];
  s.channels = [...new Map([...s.channels, ...connected].map(c => [c.id, c])).values()];
  return s;
}
