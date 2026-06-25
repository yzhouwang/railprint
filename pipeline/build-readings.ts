// Offline romaji join for N02 station groups.
//
// Normal builds read the committed OSM/Wikidata caches in data/readings/.
// `--refresh` is intentionally separate and never used by the package build.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { haversineKm } from './geometry.ts';

type RomaSource = 'osm' | 'wikidata' | 'manual';

export interface StationReading {
  romaji: string;
  source: RomaSource;
}

interface N02Feature {
  properties: Record<string, string | number | number[] | undefined>;
}

interface N02FC {
  features: N02Feature[];
}

interface StationGroup {
  id: string;
  name: string;
  lon: number;
  lat: number;
  operators: Set<string>;
  lines: Set<string>;
}

interface OsmNode {
  lat: number;
  lon: number;
  tags?: Record<string, string | undefined>;
}

interface WikiBinding {
  coord?: { value?: string };
  en?: { value?: string };
}

interface WikiLineBinding {
  op?: { value?: string };
  ja?: { value?: string };
  en?: { value?: string };
}

interface WikiStation {
  label: string;
  lon: number;
  lat: number;
}

export interface JoinInputs {
  n02RailSections?: N02FC;
  n02Stations: N02FC;
  osmStations: { elements?: OsmNode[] };
  wikidataStations: { results?: { bindings?: WikiBinding[] } };
  wikidataLines?: { results?: { bindings?: WikiLineBinding[] } };
  overrides?: Record<string, unknown>;
}

export interface ReviewRow {
  id: string;
  name: string;
  lon: number;
  lat: number;
  romaji?: string;
  source?: string;
  confidence: 'tier2-spatial' | 'wikidata' | 'unmatched';
  operators: string[];
  lines: string[];
}

export interface JoinResult {
  stationReadings: Record<string, StationReading>;
  lineReadings: Record<string, string>;
  reviewRows: ReviewRow[];
  stats: {
    groups: number;
    matched: number;
    coverage: number;
    tier1: number;
    tier2: number;
    wikidata: number;
    manual: number;
    unmatched: number;
  };
}

interface Candidate<T> {
  item: T;
  lon: number;
  lat: number;
}

interface LineGroup {
  operator: string;
  name: string;
}

class SpatialIndex<T> {
  private readonly cells = new Map<string, Candidate<T>[]>();
  private readonly cellDeg: number;

  constructor(items: Candidate<T>[], cellDeg = 0.02) {
    this.cellDeg = cellDeg;
    for (const item of items) {
      const key = this.keyFor(item.lon, item.lat);
      const arr = this.cells.get(key);
      if (arr) arr.push(item);
      else this.cells.set(key, [item]);
    }
  }

  nearest(lon: number, lat: number, maxKm: number): { item: T; km: number } | null {
    const cx = Math.floor(lon / this.cellDeg);
    const cy = Math.floor(lat / this.cellDeg);
    const radius = Math.max(1, Math.ceil(maxKm / 1.5));
    let best: { item: T; km: number } | null = null;
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        const arr = this.cells.get(`${cx + dx},${cy + dy}`);
        if (!arr) continue;
        for (const cand of arr) {
          const km = haversineKm([lon, lat], [cand.lon, cand.lat]);
          if (km <= maxKm && (!best || km < best.km)) best = { item: cand.item, km };
        }
      }
    }
    return best;
  }

  private keyFor(lon: number, lat: number): string {
    return `${Math.floor(lon / this.cellDeg)},${Math.floor(lat / this.cellDeg)}`;
  }
}

const STATION_SUFFIX_RE = /\s+(?:station|railway station|tram stop|stop|eki|sta\.)$/i;
const MACRON_MAP: Record<string, string> = {
  ā: 'a', Ā: 'A', á: 'a', Á: 'A',
  ī: 'i', Ī: 'I', í: 'i', Í: 'I',
  ū: 'u', Ū: 'U', ú: 'u', Ú: 'U',
  ē: 'e', Ē: 'E', é: 'e', É: 'E',
  ō: 'o', Ō: 'O', ó: 'o', Ó: 'O',
};

function stripDiacritics(s: string): string {
  return s.replace(/[āĀáÁīĪíÍūŪúÚēĒéÉōŌóÓ]/g, (m) => MACRON_MAP[m] ?? m)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}

function titleToken(token: string): string {
  if (/^[A-Z0-9]{2,}$/.test(token)) return token;
  if (!/[A-Za-z]/.test(token)) return token;
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

export function normalizeRomaji(value: string, stripStationSuffix = true): string {
  let out = stripDiacritics(value)
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  if (stripStationSuffix) out = out.replace(STATION_SUFFIX_RE, '');
  out = out.replace(/\s+/g, ' ').trim();
  return out
    .split(/(\s+|-|\/)/)
    .map((part) => (/^\s+$|^-$|^\/$/.test(part) ? part : titleToken(part)))
    .join('')
    .trim();
}

function stationRomajiFromOsm(node: OsmNode): string | undefined {
  const tags = node.tags ?? {};
  const raw = tags['name:en'] ?? tags['name:ja-Latn'] ?? tags.name_latn ?? tags['name:ja_rm'];
  return raw ? normalizeRomaji(raw) : undefined;
}

function parseWikiCoord(value?: string): [number, number] | null {
  const m = /^Point\(([-0-9.]+)\s+([-0-9.]+)\)$/.exec(value ?? '');
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function stripJpStationSuffix(name: string): string {
  return name.replace(/駅$/u, '');
}

function parseStationGroups(n02Stations: N02FC): StationGroup[] {
  const acc = new Map<string, StationGroup & { count: number }>();
  for (const f of n02Stations.features) {
    const p = f.properties;
    const id = String(p.N02_005g ?? p.N02_005c ?? '');
    const name = String(p.N02_005 ?? '');
    const dp = p.display_point as number[] | undefined;
    if (!id || !name || !Array.isArray(dp) || dp.length < 2) continue;
    const lon = Number(dp[0]);
    const lat = Number(dp[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    let g = acc.get(id);
    if (!g) {
      g = { id, name, lon: 0, lat: 0, count: 0, operators: new Set(), lines: new Set() };
      acc.set(id, g);
    }
    g.lon += lon;
    g.lat += lat;
    g.count += 1;
    g.operators.add(String(p.N02_004 ?? ''));
    g.lines.add(String(p.N02_003 ?? ''));
  }
  return [...acc.values()].map((g) => ({
    id: g.id,
    name: g.name,
    lon: g.lon / g.count,
    lat: g.lat / g.count,
    operators: g.operators,
    lines: g.lines,
  }));
}

function parseOsmStations(osmStations: { elements?: OsmNode[] }): OsmNode[] {
  return (osmStations.elements ?? [])
    .filter((n) => Number.isFinite(n.lon) && Number.isFinite(n.lat) && stationRomajiFromOsm(n));
}

function parseWikiStations(wikidataStations: { results?: { bindings?: WikiBinding[] } }): WikiStation[] {
  const out: WikiStation[] = [];
  for (const b of wikidataStations.results?.bindings ?? []) {
    const coord = parseWikiCoord(b.coord?.value);
    const label = b.en?.value;
    if (!coord || !label) continue;
    const romaji = normalizeRomaji(label);
    if (romaji) out.push({ label: romaji, lon: coord[0], lat: coord[1] });
  }
  return out;
}

function readStationOverrides(overrides: Record<string, unknown> | undefined): Record<string, StationReading> {
  const src = (overrides?.stationReadings ?? overrides?.stations ?? {}) as Record<string, unknown>;
  const out: Record<string, StationReading> = {};
  for (const [id, value] of Object.entries(src)) {
    if (typeof value === 'string') out[id] = { romaji: normalizeRomaji(value), source: 'manual' };
    else if (value && typeof value === 'object') {
      const raw = (value as { romaji?: unknown; nameRoma?: unknown }).romaji ?? (value as { nameRoma?: unknown }).nameRoma;
      if (typeof raw === 'string') out[id] = { romaji: normalizeRomaji(raw), source: 'manual' };
    }
  }
  return out;
}

function curatedLineReadings(): Record<string, string> {
  return {
    '北海道旅客鉄道\u0000北海道新幹線': 'Hokkaido Shinkansen',
    '東日本旅客鉄道\u0000東北新幹線': 'Tohoku Shinkansen',
    '東日本旅客鉄道\u0000上越新幹線': 'Joetsu Shinkansen',
    '東日本旅客鉄道\u0000北陸新幹線': 'Hokuriku Shinkansen',
    '東海旅客鉄道\u0000東海道新幹線': 'Tokaido Shinkansen',
    '西日本旅客鉄道\u0000山陽新幹線': 'Sanyo Shinkansen',
    '九州旅客鉄道\u0000九州新幹線': 'Kyushu Shinkansen',
    '東日本旅客鉄道\u0000山手線': 'Yamanote Line',
    '西日本旅客鉄道\u0000大阪環状線': 'Osaka Loop Line',
    '東日本旅客鉄道\u0000中央線': 'Chuo Line',
    '東日本旅客鉄道\u0000横須賀線': 'Yokosuka Line',
    '東海旅客鉄道\u0000東海道線': 'Tokaido Line',
    '西日本旅客鉄道\u0000東海道線': 'Tokaido Line',
    '西日本旅客鉄道\u0000山陽線': 'Sanyo Line',
  };
}

export function n02LineReadingKey(operator: string, line: string): string {
  return `${operator}\u0000${line}`;
}

function parseLineGroups(n02Lines: N02FC): LineGroup[] {
  const seen = new Set<string>();
  const out: LineGroup[] = [];
  for (const f of n02Lines.features) {
    const p = f.properties;
    const operator = String(p.N02_004 ?? '');
    const name = String(p.N02_003 ?? '');
    if (!operator || !name) continue;
    const key = n02LineReadingKey(operator, name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ operator, name });
  }
  return out.sort((a, b) => n02LineReadingKey(a.operator, a.name).localeCompare(n02LineReadingKey(b.operator, b.name), 'ja'));
}

function normalizeWikiJaLineLabel(label: string): string {
  let out = label.trim();
  for (;;) {
    const next = out.replace(/\s*(?:（[^（）]*）|\([^()]*\))\s*$/u, '').trim();
    if (next === out) return out;
    out = next;
  }
}

function parseWikiLineReadings(wikidataLines: { results?: { bindings?: WikiLineBinding[] } } | undefined): {
  byOperatorName: Map<string, string>;
  byName: Map<string, string>;
} {
  const byOperatorNameRaw = new Map<string, string[]>();
  const byNameRaw = new Map<string, string[]>();
  for (const b of wikidataLines?.results?.bindings ?? []) {
    const op = b.op?.value;
    const ja = b.ja?.value;
    const en = b.en?.value;
    if (!ja || !en) continue;
    const name = normalizeWikiJaLineLabel(ja);
    const romaji = normalizeRomaji(en, false);
    if (!name || !romaji) continue;
    if (op) {
      const key = n02LineReadingKey(op, name);
      const arr = byOperatorNameRaw.get(key);
      if (arr) arr.push(romaji);
      else byOperatorNameRaw.set(key, [romaji]);
    }
    const arr = byNameRaw.get(name);
    if (arr) arr.push(romaji);
    else byNameRaw.set(name, [romaji]);
  }

  const pick = (src: Map<string, string[]>): Map<string, string> => {
    const out = new Map<string, string>();
    for (const [name, labels] of src) {
      labels.sort((a, b) => a.length - b.length || a.localeCompare(b));
      out.set(name, labels[0]);
    }
    return out;
  };
  return { byOperatorName: pick(byOperatorNameRaw), byName: pick(byNameRaw) };
}

function lineNameCounts(groups: LineGroup[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const g of groups) counts.set(g.name, (counts.get(g.name) ?? 0) + 1);
  return counts;
}

function unambiguousWikiLineReading(
  key: string,
  name: string,
  nameCounts: Map<string, number>,
  wikiLineReadings: ReturnType<typeof parseWikiLineReadings>,
): string | undefined {
  const exact = wikiLineReadings.byOperatorName.get(key);
  if (exact) return exact;
  if ((nameCounts.get(name) ?? 0) !== 1) return undefined;
  return wikiLineReadings.byName.get(name);
}

export function buildReadings(inputs: JoinInputs): JoinResult {
  const groups = parseStationGroups(inputs.n02Stations);
  const osm = parseOsmStations(inputs.osmStations);
  const wiki = parseWikiStations(inputs.wikidataStations);

  const osmByName = new Map<string, OsmNode[]>();
  for (const node of osm) {
    const name = node.tags?.name;
    if (!name) continue;
    const arr = osmByName.get(name);
    if (arr) arr.push(node);
    else osmByName.set(name, [node]);
  }
  const osmSpatial = new SpatialIndex(osm.map((item) => ({ item, lon: item.lon, lat: item.lat })));
  const wikiSpatial = new SpatialIndex(wiki.map((item) => ({ item, lon: item.lon, lat: item.lat })));
  const overrides = readStationOverrides(inputs.overrides);

  const stationReadings: Record<string, StationReading> = {};
  const reviewRows: ReviewRow[] = [];
  const stats = { tier1: 0, tier2: 0, wikidata: 0, manual: 0, unmatched: 0 };

  for (const group of groups) {
    let matched: StationReading | undefined;
    let matchedTier: 'tier1' | 'tier2' | 'wikidata' | undefined;
    let review: ReviewRow['confidence'] | undefined;

    const exact = osmByName.get(group.name) ?? [];
    let exactBest: { node: OsmNode; km: number } | null = null;
    for (const node of exact) {
      const km = haversineKm([group.lon, group.lat], [node.lon, node.lat]);
      if (km <= 0.7 && (!exactBest || km < exactBest.km)) exactBest = { node, km };
    }
    if (exactBest) {
      const romaji = stationRomajiFromOsm(exactBest.node);
      if (romaji) {
        matched = { romaji, source: 'osm' };
        matchedTier = 'tier1';
        stats.tier1 += 1;
      }
    }

    if (!matched) {
      const nearest = osmSpatial.nearest(group.lon, group.lat, 0.25);
      if (nearest) {
        const romaji = stationRomajiFromOsm(nearest.item);
        if (romaji) {
          matched = { romaji, source: 'osm' };
          matchedTier = 'tier2';
          review = 'tier2-spatial';
          stats.tier2 += 1;
        }
      }
    }

    if (!matched) {
      const nearest = wikiSpatial.nearest(group.lon, group.lat, 0.7);
      if (nearest) {
        const jpBare = stripJpStationSuffix(group.name);
        const romaji = normalizeRomaji(nearest.item.label);
        if (romaji && jpBare) {
          matched = { romaji, source: 'wikidata' };
          matchedTier = 'wikidata';
          review = 'wikidata';
          stats.wikidata += 1;
        }
      }
    }

    const manual = overrides[group.id];
    if (manual) {
      if (matchedTier) stats[matchedTier] = Math.max(0, stats[matchedTier] - 1);
      matched = manual;
      matchedTier = undefined;
      review = undefined;
      stats.manual += 1;
    }

    if (matched) stationReadings[group.id] = matched;
    else {
      review = 'unmatched';
      stats.unmatched += 1;
    }

    if (review) {
      reviewRows.push({
        id: group.id,
        name: group.name,
        lon: Math.round(group.lon * 1e6) / 1e6,
        lat: Math.round(group.lat * 1e6) / 1e6,
        romaji: matched?.romaji,
        source: matched?.source,
        confidence: review,
        operators: [...group.operators].filter(Boolean).sort(),
        lines: [...group.lines].filter(Boolean).sort(),
      });
    }
  }

  const lineReadings = curatedLineReadings();
  const wikiLineReadings = parseWikiLineReadings(inputs.wikidataLines);
  const lineGroups = parseLineGroups(inputs.n02RailSections ?? inputs.n02Stations);
  const nameCounts = lineNameCounts(lineGroups);
  for (const g of lineGroups) {
    const key = n02LineReadingKey(g.operator, g.name);
    if (lineReadings[key]) continue;

    const wikiReading = unambiguousWikiLineReading(key, g.name, nameCounts, wikiLineReadings);
    if (wikiReading) {
      lineReadings[key] = wikiReading;
      continue;
    }

    if (g.name.endsWith('線')) {
      const base = g.name.replace(/線$/, '').replace(/新幹$/, '');
      if (/^[A-Za-z0-9 -]+$/.test(base)) {
        lineReadings[key] = g.name.endsWith('新幹線')
          ? `${normalizeRomaji(base, false)} Shinkansen`
          : `${normalizeRomaji(base, false)} Line`;
      }
    }
  }

  const matched = Object.keys(stationReadings).length;
  return {
    stationReadings,
    lineReadings,
    reviewRows,
    stats: {
      groups: groups.length,
      matched,
      coverage: groups.length ? matched / groups.length : 1,
      ...stats,
    },
  };
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

async function refreshCaches(): Promise<void> {
  const overpassQuery = '[out:json][timeout:120]; area["ISO3166-1"="JP"][admin_level=2]->.jp; node["railway"="station"](area.jp); out tags center;';
  const sparql = `
SELECT ?s ?coord ?en WHERE {
  ?s wdt:P31/wdt:P279* wd:Q55488 ;
     wdt:P17 wd:Q17 ;
     rdfs:label ?en ;
     wdt:P625 ?coord .
  FILTER(LANG(?en) = "en")
}`.trim();
  const overpass = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: overpassQuery }),
  });
  if (!overpass.ok) throw new Error(`Overpass refresh failed: ${overpass.status} ${overpass.statusText}`);
  writeFileSync('data/readings/osm-stations.json', JSON.stringify(await overpass.json()));

  const wikidata = await fetch('https://query.wikidata.org/sparql', {
    method: 'POST',
    headers: { accept: 'application/sparql-results+json', 'content-type': 'application/sparql-query' },
    body: sparql,
  });
  if (!wikidata.ok) throw new Error(`Wikidata refresh failed: ${wikidata.status} ${wikidata.statusText}`);
  writeFileSync('data/readings/wikidata-stations.json', JSON.stringify(await wikidata.json()));
}

async function main(): Promise<void> {
  if (process.argv.includes('--refresh')) await refreshCaches();

  const n02Stations = readJson('data/n02/stations.json') as N02FC;
  const n02RailSections = readJson('data/n02/rail-sections.json') as N02FC;
  const osmStations = readJson('data/readings/osm-stations.json') as { elements?: OsmNode[] };
  const wikidataStations = readJson('data/readings/wikidata-stations.json') as { results?: { bindings?: WikiBinding[] } };
  const wikidataLines = readJson('data/readings/wikidata-lines.json') as { results?: { bindings?: WikiLineBinding[] } };
  const overrides = existsSync('overrides/jp-n02-overrides.json')
    ? readJson('overrides/jp-n02-overrides.json') as Record<string, unknown>
    : {};
  const result = buildReadings({ n02RailSections, n02Stations, osmStations, wikidataStations, wikidataLines, overrides });

  writeFileSync('data/readings/station-readings.json', `${JSON.stringify(result.stationReadings, null, 2)}\n`);
  writeFileSync('data/readings/line-readings.json', `${JSON.stringify(result.lineReadings, null, 2)}\n`);
  writeFileSync('data/readings/station-readings-review.json', `${JSON.stringify(result.reviewRows, null, 2)}\n`);
  console.log(`station readings: ${result.stats.matched}/${result.stats.groups} (${(result.stats.coverage * 100).toFixed(2)}%)`);
  console.log(`line readings: ${Object.keys(result.lineReadings).length}`);
  console.log(`tier1=${result.stats.tier1} tier2=${result.stats.tier2} wikidata=${result.stats.wikidata} manual=${result.stats.manual} unmatched=${result.stats.unmatched}`);
  console.log(`review rows: ${result.reviewRows.length}`);
  console.log('credit: Romanizations © OpenStreetMap contributors, ODbL');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
