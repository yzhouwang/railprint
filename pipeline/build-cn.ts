// Build the 京沪高速铁路 (Beijing–Shanghai HSR) RailGeoPackage — the one China corridor that
// proves the country-agnostic schema (T3/T9). It reads the curated, checked-in WGS-84 station
// extract (data/cn/jinghu.json) — NO live Overpass at build time, so CI is deterministic — feeds
// the station-sequence polyline through the SAME generic builder the JP pipeline uses, then attaches
// the UX metadata (color/operator/nameRoma/rank) the sparse LineBuildInput leaves off.
// Usage: node pipeline/build-cn.ts [--out <file>]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildRailGeoPackage, type LineBuildInput } from './build-package.ts';

interface Extract {
  lineId: string;
  name: string;
  nameRoma: string;
  operator: string;
  color: string;
  isHSR: boolean;
  publishedKm: number;
  stations: { name: string; nameRoma: string; lon: number; lat: number }[];
}

const extract = JSON.parse(readFileSync('data/cn/jinghu.json', 'utf8')) as Extract;

const line: LineBuildInput = {
  lineId: extract.lineId,
  name: extract.name,
  country: 'CN',
  isHSR: extract.isHSR,
  isLoop: false,
  sequenceStrategy: 'input', // the extract lists stations pre-ordered, north → south
  sections: [
    { sectionId: `${extract.lineId}:s0`, coordinates: extract.stations.map((s) => [s.lon, s.lat]) },
  ],
  stations: extract.stations.map((s) => ({ name: s.name, lon: s.lon, lat: s.lat })),
};

const { railGeoPackage, validationReport } = buildRailGeoPackage({
  version: '2025.1.0',
  country: 'CN',
  generatedAt: '2025-04-01T00:00:00.000Z',
  lines: [line],
});

// Attach the UX metadata the generic (N02-shaped) builder leaves off.
const romaByName = new Map(extract.stations.map((s) => [s.name, s.nameRoma]));
for (const l of railGeoPackage.lines) {
  l.color = extract.color;
  l.nameRoma = extract.nameRoma;
  l.operator = extract.operator;
  l.rank = 0; // HSR tier — visible at the national zoom
}
for (const st of railGeoPackage.stations) {
  const roma = romaByName.get(st.name);
  if (roma) st.nameRoma = roma;
}

const km = railGeoPackage.segments.reduce((a, s) => a + s.km, 0);
console.log(
  `CN package: lines=${railGeoPackage.lines.length} stations=${railGeoPackage.stations.length} segments=${railGeoPackage.segments.length}`,
);
console.log(
  `京沪高速铁路 km=${km.toFixed(1)} (published ~${extract.publishedKm}km; the curated 13-station polyline runs shorter than the 24-stop real line)`,
);
const issues = validationReport.lines.flatMap((l) => l.issues);
for (const issue of issues) {
  console.log('  validation:', issue.severity, issue.code, issue.message);
}
// Never publish a broken corridor: a validation ERROR (or an empty package) fails the build so
// CI can't ship an artifact the app would then silently drop.
if (issues.some((i) => i.severity === 'error') || railGeoPackage.segments.length === 0) {
  console.error('build-cn: validation errors or empty package — refusing to write.');
  process.exit(1);
}

const outIdx = process.argv.indexOf('--out');
const out = outIdx >= 0 ? process.argv[outIdx + 1] : 'public/rail/cn-jinghu-2025.json';
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(railGeoPackage));
console.log('wrote', out);
