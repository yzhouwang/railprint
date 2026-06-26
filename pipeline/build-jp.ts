// Build the real JP RailGeoPackage from the N02 GeoJSON and sanity-check key lines.
// Usage: node pipeline/build-jp.ts [--out <file>]
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { buildPackageFromN02, groupN02, lineId } from './n02-ingest.ts';
import { buildLineReadings } from './build-readings.ts';
import type { WikiLineBinding } from './build-readings.ts';
import { buildLineStyleIndex, logoCredit } from './line-style.ts';
import type { LogoIndex, WikiStyleCache } from './line-style.ts';

const RS = JSON.parse(readFileSync('data/n02/rail-sections.json', 'utf8'));
const ST = JSON.parse(readFileSync('data/n02/stations.json', 'utf8'));
const stationReadings = existsSync('data/readings/station-readings.json')
  ? JSON.parse(readFileSync('data/readings/station-readings.json', 'utf8'))
  : {};
const rawLines = groupN02(RS, ST);
const cachedLineReadings = existsSync('data/readings/line-readings.json')
  ? JSON.parse(readFileSync('data/readings/line-readings.json', 'utf8'))
  : {};
const wikidataLines = existsSync('data/readings/wikidata-lines.json')
  ? JSON.parse(readFileSync('data/readings/wikidata-lines.json', 'utf8')) as { results?: { bindings?: WikiLineBinding[] } }
  : undefined;
const lineReadings = buildLineReadings(rawLines, wikidataLines, cachedLineReadings);
const wikidataStyle = existsSync('data/readings/wikidata-line-style.json')
  ? JSON.parse(readFileSync('data/readings/wikidata-line-style.json', 'utf8')) as WikiStyleCache
  : {};
const logoIndex = existsSync('data/readings/logo-index.json')
  ? JSON.parse(readFileSync('data/readings/logo-index.json', 'utf8')) as LogoIndex
  : {};
const lineStyles = buildLineStyleIndex(rawLines, wikidataStyle, logoIndex);
const styleByLineId = new Map(rawLines.map((raw) => [lineId(raw.operator, raw.name), lineStyles[`${raw.operator}\u0000${raw.name}`]]));

const { pkg, stats } = buildPackageFromN02(RS, ST, {
  country: 'JP',
  version: '2025.1.0',
  generatedAt: '2025-04-01T00:00:00.000Z',
  simplifyTolDeg: 0.00008, // ~9m — plenty for map zooms, big size win
  stationReadings,
  lineReadings,
  lineStyles,
});
console.log('stats', stats);
console.log('package: lines', pkg.lines.length, 'segments', pkg.segments.length, 'stations', pkg.stations.length);

const slug = lineId; // single source of truth for the line-id scheme (no drift)
const checks: [string, string, string][] = [
  ['東日本旅客鉄道', '山手線', '~34.5km / 30 / loop'],
  ['東海旅客鉄道', '東海道新幹線', '~515km / 17 / HSR'],
  ['西日本旅客鉄道', '大阪環状線', '~21.7km / 19 / loop'],
  ['東日本旅客鉄道', '中央線', '(Tokyo)'],
];
for (const [op, name, expect] of checks) {
  const id = slug(op, name);
  const l = pkg.lines.find((x) => x.lineId === id);
  if (!l) { console.log(`  ${name}: NOT FOUND (${id})`); continue; }
  const segs = pkg.segments.filter((s) => s.lineId === id);
  const km = segs.reduce((a, s) => a + s.km, 0);
  console.log(`  ${name}: km=${km.toFixed(1)} stations=${l.stationOrder.length} segs=${segs.length} loop=${l.isLoop} hsr=${l.isHSR}   [expect ${expect}]`);
}

const explicitOutIndex = process.argv.indexOf('--out');
const hasExplicitOut = explicitOutIndex >= 0;
const out = hasExplicitOut ? process.argv[explicitOutIndex + 1] : 'data/n02/jp-package.json';
const logoDir = 'public/rail/logos';
const logoCredits: Record<string, { src: string; license: 'Wikimedia Commons' }> = {};
rmSync(logoDir, { recursive: true, force: true });
mkdirSync(logoDir, { recursive: true });
for (const line of pkg.lines) {
  const style = styleByLineId.get(line.lineId);
  if (!line.logo || !style?.logoFile) continue;
  const credit = logoCredit(style);
  if (!credit) continue;
  copyFileSync(`data/readings/${style.logoFile}`, `${logoDir}/${line.lineId}.png`);
  logoCredits[line.lineId] = credit;
}
writeFileSync('public/rail/logo-credits.json', `${JSON.stringify(logoCredits, null, 2)}\n`);
console.log('logos', Object.keys(logoCredits).length, 'wrote public/rail/logo-credits.json');

const json = JSON.stringify(pkg);
writeFileSync(out, json);
console.log('wrote', out, (json.length / 1e6).toFixed(1), 'MB');
if (!hasExplicitOut) {
  writeFileSync('public/rail/jp-2025.json', json);
  console.log('wrote public/rail/jp-2025.json', (json.length / 1e6).toFixed(1), 'MB');
}
