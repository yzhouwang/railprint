# AGENTS.md — RailPrint

This repo is built by two coding agents in parallel lanes. **Read your lane's plan and stay in it.**

- **GPT-5.5 (codex CLI) = the engine.** Geometry pipeline + projection + tests. Your plan: `docs/agents/CODEX_PLAN.md`. Your dirs: `pipeline/ rail-geo/ overrides/ tests/geometry/ e2e/`. You produce ONE cross-lane artifact: the `RailGeoPackage`.
- **Opus 4.8 (claude) = the experience + app kernel.** Importer + resolver/store + all UI. Your plan: `docs/agents/CLAUDE_PLAN.md`. Your dir: `src/`.

## Rules for both
1. Code against `src/contract/types.ts`. **Never edit the contract** — flag the steering-control session if a type is wrong.
2. Stay in your lane's directories. Do not touch the other lane's files.
3. **Do not over-claim "done."** A task is complete only when the golden-file tests (`tests/geometry/`) + the relevant Playwright E2E (`e2e/`) pass. The test gate is the arbiter, not your self-report.
4. Smallest correct change. No unrequested package installs, no editing adjacent unmentioned files, no premature abstractions.
5. Branch per task (`codex/T2-stitch`, `claude/T6-map`), ship via PR into `master`. Implementation always on a feature branch — never commit straight to `master`.

Full split rationale + integration order: `docs/agents/ORCHESTRATION.md`.

## Stack
Vite + Svelte (static, no backend) · TypeScript strict · MapLibre GL JS v4 · PMTiles · Dexie/IndexedDB · turf.js (build-time only) · `<canvas>` · Vitest + Playwright. Hosted on GitHub/Cloudflare Pages. Design system: `DESIGN.md`.
