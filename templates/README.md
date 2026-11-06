# Six video formats

- **[Split board](split-board/template.mjs)** — A dark explanatory stage above a camera card. Use for a demonstration, process, tool or a concrete number that benefits from a visual beat. [Skill](../skills/format-split-board/SKILL.md).
- **[Black frame](black-frame/template.mjs)** — Horizontal footage inside a vertical black canvas. Use for screen recordings, slides or a wide shot whose content must remain legible. [Skill](../skills/format-black-frame/SKILL.md).
- **[Cinema talk](cinema-talk/template.mjs)** — Full-screen vertical talking head with restrained captions and timed punch-ins. Use when the speaker’s delivery carries the content. [Skill](../skills/format-cinema-talk/SKILL.md).
- **[Selfie headline](selfie-headline/template.mjs)** — Full-screen vertical footage with a persistent sentence above the face. Use for an informal observation or a single strong point. [Skill](../skills/format-selfie-headline/SKILL.md).
- **[Q&A card](qa-card/template.mjs)** — A camera card with a question card and a headline. Use for Q&A, interviews and teaching extracts with a real question. [Skill](../skills/format-qa-card/SKILL.md).
- **[Type depth](typo-depth/template.mjs)** — Large opening words behind the speaker, then stacked emphasis typography. Use for a camera clip with a short, clearly timed opening. [Skill](../skills/format-typo-depth/SKILL.md).

## Renderer contract

Each folder exports `{ meta, style(ctx), spec(ctx), overlays?(ctx), images?(ctx) }` from `template.mjs`. The full contract is in `src/lib/templates.ts`.

- `style` patches the included rendering engine; `spec` becomes its `window.SPEC`. Engine scene/style references: `vendor/video-agent-skills/skills/short-editing/references/`.
- Template/spec times are TAKE seconds; overlay `from`/`to` are FINAL seconds after cuts.
- Inputs come from `ctx`; no creator-specific text, source path or timings in templates.
- Fonts and colors come from `brand.mjs`.
- A screen recording falls back to a screen-compatible format; the pipeline does not crop away the interface to force a face format.
- Run `node --no-warnings tools/render-smoke.ts` for a synthetic-media export without provider calls.
