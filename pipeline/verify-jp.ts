// Golden gate for the built JP package. Two kinds of check:
//   1. Internal consistency (no external truth needed): detour ratio (segment km vs the
//      straight-line station chain), absurd single segments, and how many stations were
//      dropped as off-line. These catch a spine that wandered down the wrong branch.
//   2. Curated ground truth: Shinkansen 営業キロ are well-known and equal their 線名 length
//      (each Shinkansen is one named line), so they're reliable anchors. Plus a few majors.
// Exit non-zero if any anchor deviates >12% or any hard sanity check trips.
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { RailGeoPackage, RailLine } from '../src/contract/types.ts';
import { haversineKm } from './geometry.ts';
import { groupN02, lineId } from './n02-ingest.ts';
import {
  buildLineStyleIndex,
  isValidHexColor,
  jrOperatorLogoTokens,
  logoFilenameFromSrc,
  logoMatchesOperatorFamily,
} from './line-style.ts';
import type { LogoIndex, WikiStyleCache } from './line-style.ts';
import { rankHistogram } from './line-rank.ts';
import type { RailLineRank } from './line-rank.ts';

const pkg = JSON.parse(readFileSync('public/rail/jp-2025.json', 'utf8')) as RailGeoPackage;
const stationReadings = JSON.parse(readFileSync('data/readings/station-readings.json', 'utf8')) as Record<string, { romaji?: string }>;
const n02Stations = JSON.parse(readFileSync('data/n02/stations.json', 'utf8')) as { features: { properties: Record<string, unknown> }[] };
const n02RailSections = JSON.parse(readFileSync('data/n02/rail-sections.json', 'utf8')) as never;
const wikidataStyle = existsSync('data/readings/wikidata-line-style.json')
  ? JSON.parse(readFileSync('data/readings/wikidata-line-style.json', 'utf8')) as WikiStyleCache
  : {};
const logoIndex = existsSync('data/readings/logo-index.json')
  ? JSON.parse(readFileSync('data/readings/logo-index.json', 'utf8')) as LogoIndex
  : {};
const logoCredits = existsSync('public/rail/logo-credits.json')
  ? JSON.parse(readFileSync('public/rail/logo-credits.json', 'utf8')) as Record<string, { src?: string; license?: string }>
  : {};

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

// ── Romaji coverage and irregular readings. ──
let failures = 0;

console.log('━━━ rank LOD tiers ━━━');
type RankedLine = RailLine & { rank?: RailLineRank };
const rankedPkgLines = pkg.lines as RankedLine[];
function isRailLineRank(rank: unknown): rank is RailLineRank {
  return rank === 0 || rank === 1 || rank === 2 || rank === 3 || rank === 4;
}
const rankedLines = rankedPkgLines.filter((line) => isRailLineRank(line.rank));
const rankCoverageOk = rankedLines.length === rankedPkgLines.length;
if (!rankCoverageOk) failures += 1;
console.log(`  ${rankCoverageOk ? '✓' : '✗'} rank coverage: ${rankedLines.length}/${rankedPkgLines.length}`);
if (!rankCoverageOk) {
  const missing = rankedPkgLines
    .filter((line) => !isRailLineRank(line.rank))
    .slice(0, 8);
  for (const line of missing) console.log(`    invalid rank: ${line.lineId} rank=${String(line.rank)}`);
}

const ranks = rankHistogram(rankedPkgLines);
const hsrLineCount = rankedPkgLines.filter((line) => line.isHSR).length;
const tier0Ok = ranks[0] === hsrLineCount;
if (!tier0Ok) failures += 1;
console.log(`  ${tier0Ok ? '✓' : '✗'} tier-0 count equals HSR line count: ${ranks[0]}/${hsrLineCount}`);
const emptyTiers = ([0, 1, 2, 3, 4] as RailLineRank[]).filter((rank) => ranks[rank] === 0);
if (emptyTiers.length) failures += 1;
console.log(`  ${emptyTiers.length === 0 ? '✓' : '✗'} no empty tiers`);
console.log(`  histogram: rank0=${ranks[0]} rank1=${ranks[1]} rank2=${ranks[2]} rank3=${ranks[3]} rank4=${ranks[4]}`);

function expectLineRank(label: string, operator: string, name: string, expected: RailLineRank): void {
  const id = lineId(operator, name);
  const line = rankedPkgLines.find((candidate) => candidate.lineId === id);
  const ok = line?.rank === expected;
  if (!ok) failures += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${label}→${expected}${line ? ` (${line.lineId}, rank=${String(line.rank)})` : ' (missing)'}`);
}

expectLineRank('東海道新幹線', '東海旅客鉄道', '東海道新幹線', 0);
expectLineRank('東海道本線', '東海旅客鉄道', '東海道線', 1);
expectLineRank('近鉄大阪線', '近畿日本鉄道', '大阪線', 1);
expectLineRank('山手線', '東日本旅客鉄道', '山手線', 2);
expectLineRank('大阪環状線', '西日本旅客鉄道', '大阪環状線', 2);
expectLineRank('只見線', '東日本旅客鉄道', '只見線', 3);
expectLineRank('広島電鉄 本線', '広島電鉄', '本線', 4);

console.log('');

console.log('━━━ operator coverage ━━━');
const linesWithOperator = pkg.lines.filter((l) => typeof l.operator === 'string' && l.operator.trim().length > 0);
const operatorCoverageOk = linesWithOperator.length === pkg.lines.length;
if (!operatorCoverageOk) failures += 1;
console.log(`  ${operatorCoverageOk ? '✓' : '✗'} operator coverage: ${linesWithOperator.length}/${pkg.lines.length}`);
if (!operatorCoverageOk) {
  const missing = pkg.lines
    .filter((l) => !(typeof l.operator === 'string' && l.operator.trim().length > 0))
    .slice(0, 8);
  for (const l of missing) console.log(`    missing operator: ${l.lineId}`);
}

console.log('━━━ romaji readings ━━━');
const withRomaji = pkg.stations.filter((s) => typeof s.nameRoma === 'string' && s.nameRoma.trim().length > 0);
const romajiCoverage = pkg.stations.length ? withRomaji.length / pkg.stations.length : 1;
const coverageOk = romajiCoverage >= 0.97;
if (!coverageOk) failures += 1;
console.log(`  ${coverageOk ? '✓' : '✗'} station nameRoma coverage: ${withRomaji.length}/${pkg.stations.length} (${(romajiCoverage * 100).toFixed(2)}%)`);
const linesWithRomaji = pkg.lines.filter((l) => typeof l.nameRoma === 'string' && l.nameRoma.trim().length > 0);
const lineRomajiCoverage = pkg.lines.length ? linesWithRomaji.length / pkg.lines.length : 1;
console.log(`  ℹ line nameRoma coverage: ${linesWithRomaji.length}/${pkg.lines.length} (${(lineRomajiCoverage * 100).toFixed(2)}%)`);

function expectStationReading(name: string, romaji: string): void {
  const matches = pkg.stations.filter((s) => s.name === name);
  const packageOk = matches.some((s) => s.nameRoma === romaji);
  const readingOk = n02Stations.features
    .filter((f) => f.properties.N02_005 === name)
    .some((f) => stationReadings[String(f.properties.N02_005g ?? f.properties.N02_005c ?? '')]?.romaji === romaji);
  const ok = packageOk || (matches.length === 0 && readingOk);
  if (!ok) failures += 1;
  const seen = [...new Set(matches.map((s) => s.nameRoma ?? '(missing)'))].sort().join(', ');
  const detail = packageOk ? '' : matches.length === 0 && readingOk ? ' (readings table; not emitted by current geometry build)' : ` (saw: ${seen})`;
  console.log(`  ${ok ? '✓' : '✗'} ${name}→${romaji}${detail}`);
}

function expectStationReadingAt(name: string, lineId: string, lon: number, lat: number, romaji: string): void {
  const matches = pkg.stations
    .filter((s) => s.name === name && s.lineId === lineId)
    .map((s) => ({ station: s, km: haversineKm([s.lon, s.lat], [lon, lat]) }))
    .sort((a, b) => a.km - b.km);
  const best = matches[0];
  const ok = !!best && best.km <= 0.2 && best.station.nameRoma === romaji;
  if (!ok) failures += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${name}@${lineId.replace(/^jp-/, '')}→${romaji}${best ? ` (${best.station.nameRoma ?? 'missing'}, ${best.km.toFixed(3)}km)` : ' (missing)'}`);
}

expectStationReading('日暮里', 'Nippori');
expectStationReading('放出', 'Hanaten');
expectStationReading('我孫子', 'Abiko');
expectStationReading('御徒町', 'Okachimachi');
expectStationReading('雑司が谷', 'Zoshigaya');
expectStationReadingAt('神戸', 'jp-わたらせ渓谷鐵道-わたらせ渓谷線', 139.356565, 36.537505, 'Godo');
expectStationReadingAt('神戸', 'jp-西日本旅客鉄道-山陽線', 135.17822, 34.67922, 'Kobe');
expectStationReadingAt('神戸', 'jp-豊橋鉄道-渥美線', 137.27737, 34.66799, 'Kambe');

// ── Line colors and logos. Sourced color means a Wikidata P465 match survived the
// operator-aware join; total color includes operator/Shinkansen defaults.
console.log('\n━━━ line styles ━━━');
const rawLines = groupN02(n02RailSections, n02Stations as never);
const lineStyles = buildLineStyleIndex(rawLines, wikidataStyle, logoIndex);
const styleByLineId = new Map(rawLines.map((raw) => [lineId(raw.operator, raw.name), lineStyles[`${raw.operator}\u0000${raw.name}`]]));
const rawByLineId = new Map(rawLines.map((raw) => [lineId(raw.operator, raw.name), raw]));
const logoEntryBySrc = new Map(Object.values(logoIndex).filter((entry) => entry.src).map((entry) => [entry.src, entry]));
const sourcedColor = pkg.lines.filter((l) => styleByLineId.get(l.lineId)?.colorSource === 'sourced');
const colored = pkg.lines.filter((l) => typeof l.color === 'string' && l.color.trim().length > 0);
const invalidColor = pkg.lines.filter((l) => !isValidHexColor(l.color));
if (colored.length !== pkg.lines.length || invalidColor.length) failures += 1;
console.log(`  ℹ sourced-color coverage: ${sourcedColor.length}/${pkg.lines.length} (${((sourcedColor.length / pkg.lines.length) * 100).toFixed(2)}%)`);
console.log(`  ${colored.length === pkg.lines.length && invalidColor.length === 0 ? '✓' : '✗'} total-color coverage: ${colored.length}/${pkg.lines.length} (${((colored.length / pkg.lines.length) * 100).toFixed(2)}%)`);
if (invalidColor.length) {
  for (const l of invalidColor.slice(0, 8)) console.log(`    invalid ${l.lineId}: ${l.color ?? '(missing)'}`);
}

const logoLines = pkg.lines.filter((l) => typeof l.logo === 'string' && l.logo.startsWith('/rail/logos/'));
const minSafeLogoCoverage = 280;
const badLogoCredits = logoLines.filter((l) => {
  const credit = logoCredits[l.lineId];
  return l.logo !== `/rail/logos/${l.lineId}.png`
    || !credit
    || typeof credit.src !== 'string'
    || credit.license !== 'Wikimedia Commons';
});
if (badLogoCredits.length) failures += 1;
if (logoLines.length < minSafeLogoCoverage) failures += 1;
console.log(`  ${badLogoCredits.length === 0 ? '✓' : '✗'} logo coverage: ${logoLines.length}/${pkg.lines.length} (${((logoLines.length / pkg.lines.length) * 100).toFixed(2)}%), credits=${Object.keys(logoCredits).length}`);
console.log(`  ${logoLines.length >= minSafeLogoCoverage ? '✓' : '✗'} logo no-regression floor: ${logoLines.length}/${minSafeLogoCoverage} (baseline before S1: 227; ambiguous service-brand rows stay fail-closed)`);
for (const l of badLogoCredits.slice(0, 8)) console.log(`    bad logo credit ${l.lineId}: ${l.logo ?? '(missing)'}`);

function logoSrcForLine(line: RailLine): string | undefined {
  return logoCredits[line.lineId]?.src;
}

function logoFilenameForLine(line: RailLine): string {
  const src = logoSrcForLine(line);
  const cacheFile = src ? logoEntryBySrc.get(src)?.file : undefined;
  const commonsFile = src ? logoFilenameFromSrc(src) : undefined;
  return commonsFile ?? cacheFile ?? '(missing)';
}

function expectLogoToken(operator: string, name: string, mustInclude: string, mustNotInclude?: string): void {
  const id = lineId(operator, name);
  const line = pkg.lines.find((l) => l.lineId === id);
  const expectedSrc = styleByLineId.get(id)?.logoSrc;
  const expectedFilename = expectedSrc ? logoFilenameFromSrc(expectedSrc) : undefined;
  const src = line ? logoSrcForLine(line) : undefined;
  const filename = line ? logoFilenameForLine(line) : '(missing)';
  const lower = filename.toLowerCase();
  const ok = !!line
    && !!line.logo
    && !!src
    && src === expectedSrc
    && filename === expectedFilename
    && lower.includes(mustInclude.toLowerCase())
    && (!mustNotInclude || !lower.includes(mustNotInclude.toLowerCase()));
  if (!ok) failures += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${operator}-${name} logo: ${filename}${expectedFilename && filename !== expectedFilename ? ` (expected ${expectedFilename})` : ''}`);
}

expectLogoToken('東日本旅客鉄道', '山手線', 'JR J');
expectLogoToken('西日本旅客鉄道', '大阪環状線', 'JRW ');
expectLogoToken('東日本旅客鉄道', '北陸新幹線', 'Shinkansen jre', 'Shinkansen jrw');
expectLogoToken('西日本旅客鉄道', '北陸新幹線', 'Shinkansen jrw', 'Shinkansen jre');
expectLogoToken('東海旅客鉄道', '東海道新幹線', 'Shinkansen jrc', 'Shinkansen jre');

const logoFamilyViolations: string[] = [];
for (const line of logoLines) {
  const raw = rawByLineId.get(line.lineId);
  const src = logoSrcForLine(line);
  if (!raw || !src || !jrOperatorLogoTokens(raw.operator)) continue;
  if (!logoMatchesOperatorFamily(raw.operator, src)) {
    logoFamilyViolations.push(`${line.lineId}: ${logoFilenameForLine(line)}`);
  }
}
if (logoFamilyViolations.length) failures += 1;
console.log(`  ${logoFamilyViolations.length === 0 ? '✓' : '✗'} JR operator-family logo invariant: ${logoFamilyViolations.length} violation(s)`);
for (const v of logoFamilyViolations.slice(0, 12)) console.log(`    ${v}`);

try {
  const publicPackageBefore = readFileSync('public/rail/jp-2025.json', 'utf8');
  const logoCreditsBefore = readFileSync('public/rail/logo-credits.json', 'utf8');
  execFileSync(process.execPath, ['pipeline/build-jp.ts', '--out', 'public/rail/jp-2025.json'], { stdio: 'pipe' });
  const publicPackageAfter = readFileSync('public/rail/jp-2025.json', 'utf8');
  const logoCreditsAfter = readFileSync('public/rail/logo-credits.json', 'utf8');
  const deterministic = publicPackageBefore === publicPackageAfter && logoCreditsBefore === logoCreditsAfter;
  if (!deterministic) failures += 1;
  console.log(`  ${deterministic ? '✓' : '✗'} deterministic rebuild bytes: public package + logo credits`);
} catch (err) {
  failures += 1;
  const message = err instanceof Error ? err.message : String(err);
  console.log(`  ✗ deterministic rebuild bytes: ${message}`);
}

const jrEastChuo = pkg.lines.find((l) => l.lineId === 'jp-東日本旅客鉄道-中央線');
const osakaMetroChuo = pkg.lines.find((l) => l.lineId === 'jp-大阪市高速電気軌道-4号線(中央線)');
const chuoDifferent = !!jrEastChuo?.color && !!osakaMetroChuo?.color && jrEastChuo.color !== osakaMetroChuo.color;
if (!chuoDifferent) failures += 1;
console.log(`  ${chuoDifferent ? '✓' : '✗'} 中央線 colors differ: JR East=${jrEastChuo?.color ?? 'missing'} Osaka Metro=${osakaMetroChuo?.color ?? 'missing'}`);

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

console.log('\n━━━ curated anchors (営業キロ) ━━━');
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
