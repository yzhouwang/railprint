#!/usr/bin/env node
// Self-contained integrity check for the vendored rail-geo artifacts — needs NO railnet checkout.
// Verifies that every package + migration map under public/rail/ matches its OWN manifest SHA-256,
// so a corrupted or partial `npm run sync:railnet` (or a hand-edit) fails the build instead of
// shipping a poisoned km denominator. Runs in the app's CI on every PR. (The cross-repo pin check —
// "are we in sync with the pinned railnet version?" — is `npm run sync:railnet:check`, which needs a
// railnet checkout and is for the maintainer / a combined CI.)

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIL = join(dirname(dirname(fileURLToPath(import.meta.url))), 'public', 'rail');
const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const rel = (p) => p.replace(/^rail\//, ''); // manifest paths are rooted at rail/

const manifestPath = join(RAIL, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error('✗ verify-rail: public/rail/manifest.json missing');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
let checked = 0;
const fail = (m) => { console.error(`✗ verify-rail: ${m}`); process.exit(1); };

for (const [ns, entry] of Object.entries(manifest.packages ?? {})) {
  const pkgPath = join(RAIL, rel(entry.path));
  if (!existsSync(pkgPath)) fail(`${ns} package ${entry.path} listed in manifest but missing on disk`);
  if (entry.sha256) {
    const got = sha256(pkgPath);
    if (got !== entry.sha256) fail(`${ns} package ${entry.path} sha256 mismatch (${got.slice(0, 8)} != ${entry.sha256.slice(0, 8)})`);
    checked += 1;
  }
  for (const m of entry.migrations ?? []) {
    const mPath = join(RAIL, rel(m.path));
    if (!existsSync(mPath)) fail(`${ns} migration ${m.path} listed in manifest but missing on disk`);
    if (m.sha256 && sha256(mPath) !== m.sha256) fail(`${ns} migration ${m.path} sha256 mismatch`);
    if (m.sha256) checked += 1;
  }
}
console.log(`✓ verify-rail: ${checked} vendored rail-geo artifact(s) match the manifest SHA-256`);
