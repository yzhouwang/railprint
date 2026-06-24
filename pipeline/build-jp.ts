// Build the real JP RailGeoPackage from the N02 GeoJSON and sanity-check key lines.
// Usage: node pipeline/build-jp.ts [--out <file>]
import { readFileSync, writeFileSync } from 'node:fs';
import { buildPackageFromN02, lineId } from './n02-ingest.ts';

const RS = JSON.parse(readFileSync('data/n02/rail-sections.json', 'utf8'));
const ST = JSON.parse(readFileSync('data/n02/stations.json', 'utf8'));

const t0 = Date.now();
const { pkg, stats } = buildPackageFromN02(RS, ST, {
  country: 'JP',
  version: '2025.1.0',
  generatedAt: '2025-04-01T00:00:00.000Z',
  simplifyTolDeg: 0.00008, // ~9m — plenty for map zooms, big size win
});
console.log('built in', ((Date.now() - t0) / 1000).toFixed(1), 's');
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

const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'data/n02/jp-package.json';
const json = JSON.stringify(pkg);
writeFileSync(out, json);
console.log('wrote', out, (json.length / 1e6).toFixed(1), 'MB');
