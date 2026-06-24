// Golden gate for the built JP package. Two kinds of check:
//   1. Internal consistency (no external truth needed): detour ratio (segment km vs the
//      straight-line station chain), absurd single segments, and how many stations were
//      dropped as off-line. These catch a spine that wandered down the wrong branch.
//   2. Curated ground truth: Shinkansen 営業キロ are well-known and equal their 線名 length
//      (each Shinkansen is one named line), so they're reliable anchors. Plus a few majors.
// Exit non-zero if any anchor deviates >12% or any hard sanity check trips.
import { readFileSync } from 'node:fs';
import type { RailGeoPackage, RailLine } from '../src/contract/types.ts';
import { haversineKm } from './geometry.ts';

const pkg = JSON.parse(readFileSync('public/rail/jp-2025.json', 'utf8')) as RailGeoPackage;

const lineKm = (id: string): number => pkg.segments.filter((s) => s.lineId === id).reduce((a, s) => a + s.km, 0);
const lineStations = (id: string): { lon: number; lat: number }[] =>
  pkg.stations.filter((s) => s.lineId === id).sort((a, b) => a.seq - b.seq);

// straight-line lower bound along the ordered station chain
function chainGcKm(id: string, loop: boolean): number {
  const st = lineStations(id);
  let km = 0;
  for (let i = 1; i < st.length; i += 1) km += haversineKm([st[i - 1].lon, st[i - 1].lat], [st[i].lon, st[i].lat]);
  if (loop && st.length > 1) km += haversineKm([st[st.length - 1].lon, st[st.length - 1].lat], [st[0].lon, st[0].lat]);
  return km;
}

interface Health { line: RailLine; km: number; gc: number; detour: number; maxSeg: number; flags: string[] }

const health: Health[] = pkg.lines.map((line) => {
  const km = lineKm(line.lineId);
  const gc = chainGcKm(line.lineId, line.isLoop);
  const detour = gc > 0 ? km / gc : Infinity;
  const segs = pkg.segments.filter((s) => s.lineId === line.lineId);
  const maxSeg = segs.reduce((m, s) => Math.max(m, s.km), 0);
  const flags: string[] = [];
  // A spine that detoured down the wrong branch inflates km far past the straight chain.
  if (detour > 2.2) flags.push(`detour×${detour.toFixed(1)}`);
  // No non-HSR inter-station hop is ~60km; no HSR hop ~120km. Bigger ⇒ a missing station / leap.
  if (maxSeg > (line.isHSR ? 120 : 60)) flags.push(`maxSeg=${maxSeg.toFixed(0)}km`);
  if (segs.length < 1) flags.push('no-segments');
  return { line, km, gc, detour, maxSeg, flags };
});

// ── curated anchors (営業キロ). Shinkansen names are unique, so name match is safe. ──
const ANCHORS: { name: string; opMatch?: RegExp; km: number; loop?: boolean }[] = [
  { name: '東海道新幹線', km: 515.4 },
  { name: '山陽新幹線', km: 553.7 },
  { name: '東北新幹線', opMatch: /東日本/, km: 674.9 },
  { name: '上越新幹線', opMatch: /東日本/, km: 269.5 },
  { name: '九州新幹線', km: 256.8 },
  { name: '北海道新幹線', km: 148.8 },
  { name: '山手線', opMatch: /東日本/, km: 20.6 },
  { name: '大阪環状線', km: 21.7, loop: true },
  { name: '横須賀線', opMatch: /東日本/, km: 23.9 },
];

let failures = 0;
console.log('━━━ curated anchors (営業キロ) ━━━');
for (const a of ANCHORS) {
  const cands = pkg.lines.filter((l) => l.name === a.name && (!a.opMatch || a.opMatch.test(l.lineId)));
  if (cands.length === 0) { console.log(`  ✗ ${a.name}: NOT FOUND`); failures += 1; continue; }
  const line = cands[0];
  const km = lineKm(line.lineId);
  const dev = Math.abs(km - a.km) / a.km;
  const loopOk = a.loop === undefined || a.loop === line.isLoop;
  const ok = dev <= 0.12 && loopOk;
  if (!ok) failures += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${a.name}: ${km.toFixed(1)}km vs ${a.km} (${(dev * 100).toFixed(0)}%)${a.loop !== undefined ? ` loop=${line.isLoop}/${a.loop}` : ''}`);
}

console.log('\n━━━ internal-consistency flags (worst 25 by detour) ━━━');
const flagged = health.filter((h) => h.flags.length).sort((a, b) => b.detour - a.detour);
for (const h of flagged.slice(0, 25)) {
  console.log(`  ${h.line.name} [${h.line.lineId.replace(/^jp-/, '')}] km=${h.km.toFixed(0)} gc=${h.gc.toFixed(0)} ${h.flags.join(' ')}`);
}
console.log(`\nflagged ${flagged.length}/${pkg.lines.length} lines; loops=${pkg.lines.filter((l) => l.isLoop).length}; hsr=${pkg.lines.filter((l) => l.isHSR).length}`);

// ── Under-length invariant (catches the self-near/branch mis-projection class — codex#1).
// A segment whose km is far below its endpoint stations' straight-line distance means the
// slice collapsed onto the wrong arc. The adapter repairs these to the chord, so any that
// reach the package are a regression. HARD failure.
const stById = new Map(pkg.stations.map((s) => [s.stationId, s]));
let underLen = 0;
const underWorst: string[] = [];
for (const s of pkg.segments) {
  const a = stById.get(s.fromStationId);
  const b = stById.get(s.toStationId);
  if (!a || !b) continue;
  const chord = haversineKm([a.lon, a.lat], [b.lon, b.lat]);
  if (chord > 0.3 && s.km < chord * 0.6) {
    underLen += 1;
    if (underWorst.length < 8) underWorst.push(`  ${s.km.toFixed(3)}km vs chord ${chord.toFixed(2)}km  ${s.lineId.replace(/^jp-/, '')}`);
  }
}
console.log(`\n━━━ under-length segments (km < 0.6× station chord): ${underLen} ━━━`);
for (const w of underWorst) console.log(w);
if (underLen > 0) failures += 1;

// Hard detour gate: a line whose summed segment km is >3× the straight station chain has a
// scrambled/looping spine producing wrong km. (2.2 is a soft flag; 3.0 is "definitely broken"
// — 0 lines hit it today, so this guards against future km-inflation regressions without
// false-failing legit long rural lines like 海峡線.)
const wildDetour = health.filter((h) => isFinite(h.detour) && h.detour > 3.0);
console.log(`\n━━━ wild-detour lines (km > 3.0× station chain): ${wildDetour.length} ━━━`);
for (const h of wildDetour.slice(0, 8)) console.log(`  ${h.line.name} detour×${h.detour.toFixed(1)} km=${h.km.toFixed(0)} gc=${h.gc.toFixed(0)}`);
if (wildDetour.length > 0) failures += 1;

const totalKm = pkg.segments.reduce((a, s) => a + s.km, 0);
console.log(`\nnetwork total: ${totalKm.toFixed(0)} km across ${pkg.lines.length} lines, ${pkg.stations.length} stations`);
console.log(`gate failures: ${failures} (anchors + under-length)`);
process.exit(failures > 0 ? 1 : 0);
