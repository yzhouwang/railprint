#!/usr/bin/env node
// Sync the rail-geo data package from railnet into RailPrint.
//
// railnet is the PRODUCER of the rail-geo packages; this app is a CONSUMER that pins a version
// (railnet.json) and vendors the built artifacts so its runtime stays same-origin (offline + SHA-256
// intact). This script copies, from a railnet checkout:
//   railnet/rail/*                 -> public/rail/*                (the released, integrity-manifested artifacts)
//   railnet/contract/rail-package.ts -> src/contract/rail-package.ts (the shared data contract — one source, no drift)
// then VERIFIES every package's bytes against railnet's manifest SHA-256 before declaring success, and
// records the synced version in railnet.json. To update the network data: bump railnet, run this, commit.
//
// Usage:  node scripts/sync-railnet.mjs            (railnet at ../railnet, or $RAILNET_PATH)
//         node scripts/sync-railnet.mjs --check    (verify in-sync, write nothing; exit 1 on drift)

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = dirname(dirname(fileURLToPath(import.meta.url)));
const PIN = JSON.parse(readFileSync(join(APP, 'railnet.json'), 'utf8'));
const RAILNET = process.env.RAILNET_PATH || join(APP, PIN.source);
const CHECK = process.argv.includes('--check');

function fail(msg) {
  console.error(`✗ sync-railnet: ${msg}`);
  process.exit(1);
}

if (!existsSync(RAILNET)) fail(`railnet not found at ${RAILNET} (set RAILNET_PATH or clone railnet beside the app)`);
const railnetPkg = JSON.parse(readFileSync(join(RAILNET, 'package.json'), 'utf8'));
if (railnetPkg.version !== PIN.version) {
  console.warn(`! railnet checkout is v${railnetPkg.version} but railnet.json pins v${PIN.version}` +
    (CHECK ? '' : ' — syncing the checkout; update railnet.json deliberately if this is a version bump.'));
}

const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

// 1. The shared contract (one source of truth across the two repos).
const contractSrc = join(RAILNET, 'contract', 'rail-package.ts');
const contractDst = join(APP, 'src', 'contract', 'rail-package.ts');
if (!existsSync(contractSrc)) fail(`missing ${relative(RAILNET, contractSrc)} in railnet`);
const contractDrift = !existsSync(contractDst) || sha256(contractSrc) !== sha256(contractDst);

// 2. The artifacts.
const railSrc = join(RAILNET, 'rail');
const railDst = join(APP, 'public', 'rail');
if (!existsSync(join(railSrc, 'manifest.json'))) fail(`missing rail/manifest.json in railnet`);

// list every file under a dir (relative paths)
function walk(root, base = root, out = []) {
  for (const name of readdirSync(root)) {
    const p = join(root, name);
    if (statSync(p).isDirectory()) walk(p, base, out);
    else out.push(relative(base, p));
  }
  return out;
}
const srcFiles = walk(railSrc).sort();
const railDrift = srcFiles.some((f) => !existsSync(join(railDst, f)) || sha256(join(railSrc, f)) !== sha256(join(railDst, f)));

if (CHECK) {
  if (contractDrift || railDrift) fail('app is OUT OF SYNC with railnet — run `npm run sync:railnet`');
  console.log(`✓ in sync with railnet v${railnetPkg.version} (${srcFiles.length} artifacts, contract matches)`);
  process.exit(0);
}

// Write the contract.
if (contractDrift) cpSync(contractSrc, contractDst);
// Mirror rail/ exactly (remove stale files, copy fresh).
rmSync(railDst, { recursive: true, force: true });
mkdirSync(railDst, { recursive: true });
for (const f of srcFiles) {
  const dst = join(railDst, f);
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(join(railSrc, f), dst);
}

// 3. Verify the synced packages against railnet's manifest SHA-256 (integrity, end to end).
const manifest = JSON.parse(readFileSync(join(railDst, 'manifest.json'), 'utf8'));
let verified = 0;
for (const [ns, entry] of Object.entries(manifest.packages ?? {})) {
  if (!entry.sha256) continue;
  const got = sha256(join(railDst, entry.path.replace(/^rail\//, '')));
  if (got !== entry.sha256) fail(`${ns} package ${entry.path} sha256 mismatch after sync (${got.slice(0, 8)} != ${entry.sha256.slice(0, 8)})`);
  verified += 1;
  for (const m of entry.migrations ?? []) {
    if (!m.sha256) continue;
    const g = sha256(join(railDst, m.path.replace(/^rail\//, '')));
    if (g !== m.sha256) fail(`${ns} migration ${m.path} sha256 mismatch after sync`);
  }
}

// Record the synced version.
if (PIN.version !== railnetPkg.version) {
  PIN.version = railnetPkg.version;
  writeFileSync(join(APP, 'railnet.json'), JSON.stringify(PIN, null, 2) + '\n');
}
console.log(`✓ synced railnet v${railnetPkg.version}: ${srcFiles.length} artifacts, contract, ${verified} packages SHA-256 verified`);
