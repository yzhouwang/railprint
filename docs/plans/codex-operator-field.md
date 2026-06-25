# Codex engine task — populate RailLine.operator + hard gate

**You own:** `pipeline/n02-ingest.ts`, `pipeline/verify-jp.ts`. **Do NOT touch** `src/`. No network.
Trailer: `Co-Authored-By: GPT-5.5 (Codex) <noreply@openai.com>`.

The steering session already added `operator?: string` to `RailLine` in `src/contract/types.ts` (do not edit that file; just rely on the field).

## Task
1. In `pipeline/n02-ingest.ts`, the line object is built around line 532-536:
   ```
   const line: RailLine = {
     lineId: id, name: raw.name, country, isHSR, isLoop,
     stationOrder: ...,
     geometry: path,
   };
   ```
   Add `operator: raw.operator,` to that object literal (raw.operator is already in scope — it is used just below at the `n02LineReadingKey(raw.operator, ...)` call).

2. In `pipeline/verify-jp.ts`, add a HARD gate check (counts toward `failures`, prints ✓/✗): every line in the built package has a non-empty string `operator`. Print `operator coverage: N/594`. Fail the build (non-zero exit) if any line is missing it. Keep all existing checks.

3. Rebuild: `node pipeline/build-jp.ts --out public/rail/jp-2025.json`.

4. Verify: `node pipeline/verify-jp.ts` (exit 0, operator coverage 594/594) and `npm test` green.

5. Commit `pipeline/n02-ingest.ts pipeline/verify-jp.ts public/rail/jp-2025.json data/n02/jp-package.json`.

## Done
Print FINAL STATUS: operator coverage (expect 594/594), a sample line's operator value, and confirm verify-jp exit 0 + npm test green.
