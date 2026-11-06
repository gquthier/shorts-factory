# Contributing

Use Node 22.18+ on macOS. Run `npm ci` and `npm run setup`; the source UI can be started with `npm run serve` (port 4783). The full renderer and QA use Apple Vision. French editing heuristics are currently the most exercised; contributions for other languages should include real timing/caption examples with redistribution rights.

`npm test` runs isolated fixtures and simulated providers. `python3 -m unittest discover -s test -p '*_test.py'` checks outlier comparisons. `node --no-warnings tools/render-smoke.ts` exercises a real generated-media render without a paid API. Do not use personal recordings as test fixtures. Provider credentials and data are never needed for unit tests.

For a format change, update the matching `templates/<id>/template.mjs`, its NOTES and `skills/format-<id>/SKILL.md`. Preserve TAKE vs FINAL timing, safe zones, truthful copy, shared brand configuration and the fallback for screen recordings. Inspect rendered frames; passing a schema test is not a visual review.

Run `npm run check:public` on the staged changes and an independent secret scan before pushing. A PR should state the user-visible behavior, tests run and any untested provider/platform behavior.
