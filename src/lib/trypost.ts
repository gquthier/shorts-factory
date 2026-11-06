import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const TRYPOST_API = 'https://app.trypost.it/api';

const AccountSchema = z.object({ id: z.string(), platform: z.string(), display_name: z.string().nullish(), username: z.string().nullish(), status: z.string() });
export type Account = z.infer<typeof AccountSchema>;

const PostSchema = z.object({
  id: z.string(), status: z.string(), publish_status: z.string().nullish(), scheduled_at: z.string().nullish(),
  platform_url: z.string().nullish(), error_message: z.string().nullish(),
});
export type RemotePost = z.infer<typeof PostSchema>;

const SnapshotSchema = z.object({
  collected_at: z.string().nullish(),
  views_count: z.number().nullish(), impressions_count: z.number().nullish(), reach_count: z.number().nullish(), reactions_count: z.number().nullish(),
  comments_count: z.number().nullish(), shares_count: z.number().nullish(), saves_count: z.number().nullish(), average_watch_time_milliseconds: z.number().nullish(),
});
const MetricEnvelope = z.object({ available: z.boolean().nullish(), snapshot: SnapshotSchema.nullish(), publication: z.object({ provider_published_at: z.string().nullish() }).nullish() });
const MetricsSchema = z.object({ metrics: z.union([MetricEnvelope, z.array(MetricEnvelope)]).nullish() });

export class TryPostError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export type PostStatus = 'draft' | 'scheduled';

/** Format and settings per network, from docs.trypost.it. Only short vertical video is ever sent. */
export function contentFor(platform: string, title: string): { content_type: string; meta: Record<string, unknown> } {
  const clean = title.replace(/[<>*]/g, '').trim();
  if (platform === 'instagram' || platform === 'instagram-facebook') return { content_type: 'instagram_reel', meta: { share_to_feed: true } };
  if (platform === 'tiktok') return { content_type: 'tiktok_video', meta: { privacy_level: 'PUBLIC_TO_EVERYONE' } };
  if (platform === 'youtube') return { content_type: 'youtube_short', meta: { title: clean.slice(0, 100) || 'Short' } };
  if (platform === 'facebook') return { content_type: 'facebook_reel', meta: {} };
  throw new Error(`Unsupported platform for video: ${platform}`);
}

export const SUPPORTED_PLATFORMS = ['instagram', 'instagram-facebook', 'tiktok', 'youtube', 'facebook'];

/** TryPost's two status fields, reduced to what the calendar shows. A rejected or failed publication is an error. */
export function publicationState(p: Pick<RemotePost, 'status' | 'publish_status'>): 'draft' | 'queued' | 'published' | 'error' {
  if (p.status === 'failed' || p.publish_status === 'failed' || p.publish_status === 'rejected') return 'error';
  if (p.status === 'published' || p.publish_status === 'published') return 'published';
  return p.status === 'draft' ? 'draft' : 'queued';
}

export type MetricsRow = Partial<Record<'views' | 'impressions' | 'reach' | 'likes' | 'comments' | 'sends' | 'saves' | 'avg_watch_s', number>> & { published_at?: string; observed_at?: string };

/** Accept both provider envelopes. Missing views must never become impressions or reach. */
export function metricsToRow(raw: unknown): MetricsRow {
  const parsed = MetricsSchema.parse(raw);
  const list = Array.isArray(parsed.metrics) ? parsed.metrics : parsed.metrics ? [parsed.metrics] : [];
  const latest = list.filter(m => m.snapshot && m.available !== false).sort((a, b) => (Date.parse(b.snapshot?.collected_at ?? '') || 0) - (Date.parse(a.snapshot?.collected_at ?? '') || 0))[0];
  const s = latest?.snapshot;
  if (!s) return {};
  const out: MetricsRow = {};
  if (latest?.publication?.provider_published_at) out.published_at = latest.publication.provider_published_at;
  if (s.collected_at) out.observed_at = s.collected_at;
  if (s.views_count != null) out.views = s.views_count;
  if (s.impressions_count != null) out.impressions = s.impressions_count;
  if (s.reach_count != null) out.reach = s.reach_count;
  if (s.reactions_count != null) out.likes = s.reactions_count;
  if (s.comments_count != null) out.comments = s.comments_count;
  if (s.shares_count != null) out.sends = s.shares_count;
  if (s.saves_count != null) out.saves = s.saves_count;
  if (s.average_watch_time_milliseconds != null) out.avg_watch_s = s.average_watch_time_milliseconds / 1000;
  return out;
}

export interface TryPostOptions { baseUrl?: string; apiKey: string; fetchImpl?: typeof fetch; retries?: number; retryDelayMs?: number }

export function createTryPostClient(opts: TryPostOptions) {
  const base = (opts.baseUrl ?? TRYPOST_API).replace(/\/$/, '');
  const doFetch = opts.fetchImpl ?? fetch;
  const retries = opts.retries ?? 3;
  const delay = opts.retryDelayMs ?? 2000;

  async function call(route: string, init: RequestInit = {}): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, delay * 2 ** (attempt - 1)));
      try {
        const res = await doFetch(`${base}${route}`, { ...init, headers: { Authorization: `Bearer ${opts.apiKey}`, Accept: 'application/json', ...(init.headers ?? {}) } });
        const text = await res.text();
        if (res.ok) return text ? JSON.parse(text) as unknown : null;
        const err = new TryPostError(res.status, `TryPost ${res.status} on ${route.split('?')[0]}: ${text.slice(0, 400)}`);
        // Rate limit, a busy channel queue, server errors: worth retrying. A bad key or a bad body never is.
        if (res.status !== 429 && res.status !== 409 && res.status < 500) throw err;
        const wait = Number(res.headers.get('retry-after'));
        if (res.status === 429 && wait > 0 && wait <= 120) await new Promise((r) => setTimeout(r, wait * 1000));
        lastError = err;
      } catch (error) {
        if (error instanceof TryPostError && error.status !== 429 && error.status !== 409 && error.status < 500) throw error;
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('TryPost request failed');
  }

  const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  return {
    async listAccounts(): Promise<Account[]> {
      const raw = await call('/social-accounts') as { data: unknown };
      return z.array(AccountSchema).parse(raw.data);
    },

    /** Returns a single-use token, valid 24 hours. */
    async upload(file: string): Promise<string> {
      const form = new FormData();
      form.append('media', new Blob([fs.readFileSync(file)], { type: 'video/mp4' }), path.basename(file));
      return z.object({ upload_token: z.string() }).parse(await call('/uploads', { method: 'POST', body: form })).upload_token;
    },

    async createPost(p: { status: PostStatus; scheduledAt?: string; socialAccountId: string; platform: string; title: string; content: string; uploadToken: string }): Promise<string> {
      const raw = await call('/posts', json('POST', {
        status: p.status, ...(p.scheduledAt ? { scheduled_at: p.scheduledAt } : {}), social_account_id: p.socialAccountId,
        content: p.content, media: [{ upload_token: p.uploadToken }], ...contentFor(p.platform, p.title),
      }));
      return z.object({ id: z.string() }).parse(raw).id;
    },

    getPost: async (id: string): Promise<RemotePost> => {
      const raw = await call(`/posts/${encodeURIComponent(id)}`) as { data?: unknown };
      return PostSchema.parse(raw.data ?? raw);
    },
    deletePost: async (id: string) => { await call(`/posts/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
    postMetrics: async (id: string): Promise<MetricsRow> => metricsToRow(await call(`/posts/${encodeURIComponent(id)}/metrics`)),
  };
}
export type TryPostClient = ReturnType<typeof createTryPostClient>;
