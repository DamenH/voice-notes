# Voice Notes

`PLAN.md` is the spec. Implement it end to end, autonomously, in its milestone
order. Do not stop to ask between milestones; record open questions in
`docs/FINDINGS.md` and pick a sensible default.

## Conventions

- Stack: Vite, TypeScript (strict), React, Tailwind, Dexie, Vitest, Playwright.
- `npm run verify` (typecheck, lint, unit tests, build, secret scan) must pass
  before every commit. Commit at the end of each milestone, and more often when
  useful, with clear messages.
- Mock OpenRouter in unit and e2e tests. Real calls only in `npm run test:live`.
- Responsive layout reference: `~/Projects/pitch-training/src/App.svelte` and
  `src/app.css` (patterns, not code to copy).

## OpenRouter key and budget

- Dev/test key: `~/dev-key.txt` (whole file is the key, $10 limit). Read it at
  runtime in test scripts only. Never print it, commit it, copy it into the project, or let
  it reach `dist/`.
- Hard cap: $5.00 of total development spend on that key. Expect to need far less.
  Check `GET https://openrouter.ai/api/v1/key` before and after live runs and log
  spend in `docs/FINDINGS.md`. Prefer `:free` and cheap models and short clips.

## Boundaries

- GitHub: use the DamenH account without changing the active `gh` account:
  prefix commands with `GH_TOKEN=$(gh auth token --user DamenH)`. Approved: create
  the public repo `DamenH/voice-notes`, push, and deploy to GitHub Pages
  (https://damenh.github.io/voice-notes/). Push at milestone ends.
- Things needing a real phone or a human login go in `docs/MANUAL-CHECKS.md`.
