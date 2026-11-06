# API de l'app (http://127.0.0.1:4783)

Toutes les réponses : `{ success: boolean, data?, error? }`. Les écritures exigent l'en-tête `Origin` de l'app, automatique depuis la page.

## Lecture

`GET /api/state` renvoie :

- `settings` : `auto_schedule`, `auto_approve`, `auto_approve_min_score`, `post_as_draft`, `post_start_hour`, `post_end_hour`, `post_min_gap_hours` (chaînes), `trypost_configured` (booléen, jamais la clé), `trypost_base_url`.
- `clips[]` : `id, source_id, start, end, category, title, why, standalone, hook, hook_type, hook_score, hooks[{text,type,score}], caption, template, status, error, question, qa, qa_status, source_title, kind`.
  - `status` : `candidate`, `hooked`, `rendered`, `qa_failed`, `review`, `approved`, `scheduled`, `exported`, `rejected`, `weak`, `failed`.
  - `qa_status` : `pass`, `warn`, `fail`. `qa` : `{ findings[{severity, code, message}], tech{...}, audio{recall, syncMedian, syncP90, firstOk, lastOk}, visual{readableShare, mouthCovered, unsafe, frames} }`.
- `channels[]` : `id, name, provider, profile, picture, enabled (0/1), disabled_upstream, max_per_day, synced_at`.
- `publications[]` : `id, clip_id, channel_id, state (planned|queued|draft|published|error), scheduled_at (ISO), release_url, error, hook, channel, provider`.
- `ideas[]` : `id, topic, angle, hook_type, hooks[], script, proof_needed[], inspired_by[], seconds, status (new|keep|filmed)`.
- `sources[]` : `id, kind, title, status, duration, error, created_at`.
- `jobs[]` : `{type, status, n}`. `running[]` : `{type, ref}`. `templates[]`. `target`. `accounts[]`. `today{n}`.

`GET /api/stats` : `byHook[], byTemplate[], byAccount[], top[], published, planned`.

`GET /api/outliers` : tableau issu de l'étude : `shortcode, url, handle, language, views, median, ratio, likes, comments, duration, posted, spoken_hook, screen_hook, format, sec_per_cut, caption_style, hook_type, topic`. Vide tant que l'étude n'existe pas.

Médias : `/media/<clipId>/final.mp4` (Range supporté), `/media/<clipId>/poster.jpg`.

## Écriture (POST sauf mention)

- `/api/sources` `{kind, url, title?, rightsConfirmed: true}`. `kind` : `youtube|live|upload|masterclass|qa`.
- `/api/upload?kind=&rights=1&name=&title=` corps = le fichier brut (progress via XHR).
- `/api/clips/:id` `{action}` : `approve`, `reject`, `reopen`, `caption {caption}`, `rerender {hook?, template?, question?}`.
- `/api/schedule` planifie tous les clips validés sur les comptes activés. Réponse `{planned}`.
- `/api/publications/:id/cancel`. Refusé si déjà publié.
- `/api/sync` lance la synchro TryPost.
- `/api/trypost/key` `{apiKey, baseUrl?}` vérifie auprès de TryPost puis stocke dans le trousseau. `DELETE` pour la retirer. Ne jamais réafficher la clé.
- `/api/channels/sync`. `/api/channels/:id` `{enabled?, maxPerDay?}`.
- `/api/settings` : sous-ensemble de `settings`.
- `/api/ideas/generate` `{count}` (asynchrone : les idées apparaissent dans `ideas`). `/api/ideas/:id` `{status: new|keep|filmed|dropped}`.
- `/api/export` écrit les validés dans `out/<date>/`.
- `/api/metrics` tableau de lignes de stats, import manuel.

## First run

`GET /api/setup` returns profile, service connection booleans, local tools and text provider. `POST /api/setup/profile` saves the validated creator profile. `POST /api/setup/connection` verifies `{service, apiKey}` before Keychain storage; `DELETE /api/setup/connection/:service` disconnects it. `POST /api/setup/llm` selects `{provider, model?}`. Credentials are never returned.
