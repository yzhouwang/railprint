// FALLBACK RailGeoPackage — a small, contract-shaped RailGeoPackage with two live roles:
//   1. PRODUCTION FALLBACK. When the real vendored package fails to fetch, store.ts loads this so
//      the app still renders (in degraded mode — `usingFallback`); it SHIPS in the bundle. This is
//      why it lives in lib/, not a test-only fixtures dir.
//   2. SHARED TEST FIXTURE. Every unit test resolves coverage/search/route against it, so the app
//      code stays identical whether it got this or the real thing.
//
// Coordinates are real-ish station points; segment `km` is a build-time haversine over consecutive
// stations (the real package uses turf over full polylines). Kept deliberately small.

import type {
  Country,
  RailGeoPackage,
  RailLine,
  RailSegment,
  RailStation,
} from '../contract/types';
import { haversineKm } from '../lib/geo';

interface StationSeed {
  name: string;
  lon: number;
  lat: number;
  // EXPERIENCE-LANE STUB ADDITION (revert when the real engine package lands): a few
  // stations carry a romaji reading + cross-line group id so the bilingual search + line
  // inference tests run without the real data. The real package sources these from OSM.
  roma?: string;
  groupId?: string;
}

interface LineSeed {
  lineId: string;
  name: string;
  operator?: string;
  nameRoma?: string;
  country: Country;
  isHSR: boolean;
  isLoop: boolean;
  // EXPERIENCE-LANE STUB ADDITION (revert when the real engine package lands): each line carries
  // its OFFICIAL color (hex) so the multicolor-map tests run without the real data; a couple carry
  // a `logo` path so the logo-vs-swatch branch is exercised. The real package sources both.
  color?: string;
  logo?: string;
  stations: StationSeed[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

interface BuiltLine {
  line: RailLine;
  segments: RailSegment[];
  stations: RailStation[];
}

function buildLine(seed: LineSeed): BuiltLine {
  const stations: RailStation[] = seed.stations.map((s, i) => ({
    stationId: `${seed.lineId}.${i}`,
    name: s.name,
    ...(s.roma ? { nameRoma: s.roma, romaSource: 'manual' as const } : {}),
    lineId: seed.lineId,
    seq: i,
    lon: s.lon,
    lat: s.lat,
    ...(s.groupId ? { stationGroupId: s.groupId } : {}),
  }));
  const stationOrder = stations.map((s) => s.stationId);

  // Consecutive inter-station pairs; a loop adds the closing wrap (last → first).
  const pairs: [RailStation, RailStation][] = [];
  for (let i = 0; i < stations.length - 1; i++) pairs.push([stations[i], stations[i + 1]]);
  if (seed.isLoop && stations.length > 2) {
    pairs.push([stations[stations.length - 1], stations[0]]);
  }

  const segments: RailSegment[] = pairs.map(([a, b]) => {
    const seg: RailSegment = {
      segmentId: `${seed.lineId}:${a.seq}-${b.seq}`,
      lineId: seed.lineId,
      fromStationId: a.stationId,
      toStationId: b.stationId,
      fromSeq: a.seq,
      toSeq: b.seq,
      km: round2(haversineKm(a, b)),
      isHSR: seed.isHSR,
      geometry: {
        type: 'LineString',
        coordinates: [
          [a.lon, a.lat],
          [b.lon, b.lat],
        ],
      },
    };
    // Loop lines: tag the canonical forward (cw) arc along stationOrder. The shared
    // physical track means coverage is the same set whichever way you ride; the tag is
    // for rendering + the marking UI's arc choice.
    if (seed.isLoop) seg.arcDirection = 'cw';
    return seg;
  });

  const coords: GeoJSON.Position[] = stations.map((s) => [s.lon, s.lat]);
  if (seed.isLoop && stations.length > 2) coords.push([stations[0].lon, stations[0].lat]);

  const line: RailLine = {
    lineId: seed.lineId,
    name: seed.name,
    ...(seed.operator ? { operator: seed.operator } : {}),
    ...(seed.nameRoma ? { nameRoma: seed.nameRoma } : {}),
    ...(seed.color ? { color: seed.color } : {}),
    ...(seed.logo ? { logo: seed.logo } : {}),
    country: seed.country,
    isHSR: seed.isHSR,
    isLoop: seed.isLoop,
    stationOrder,
    geometry: { type: 'LineString', coordinates: coords },
  };

  return { line, segments, stations };
}

function assemble(
  version: string,
  country: Country,
  generatedAt: string,
  seeds: LineSeed[],
): RailGeoPackage {
  const built = seeds.map(buildLine);
  return {
    version,
    generatedAt,
    crs: 'WGS84',
    country,
    lines: built.map((b) => b.line),
    segments: built.flatMap((b) => b.segments),
    stations: built.flatMap((b) => b.stations),
  };
}

// ───────────────────────────── JAPAN line seeds ─────────────────────────────

// 山手線 — loop, 30 stations (golden line: loop arcs).
const YAMANOTE: LineSeed = {
  lineId: 'jr-yamanote',
  name: '山手線',
  operator: '東日本旅客鉄道',
  country: 'JP',
  isHSR: false,
  isLoop: true,
  nameRoma: 'Yamanote Line',
  color: '#9ACD32', // official 黄緑 (yellow-green)
  logo: '/rail/logos/jr-yamanote.png', // stub: exercises the logo-vs-swatch branch
  stations: [
    { name: '東京', lon: 139.7671, lat: 35.6812, roma: 'Tokyo', groupId: 'g-tokyo' },
    { name: '神田', lon: 139.771, lat: 35.6918, roma: 'Kanda' },
    { name: '秋葉原', lon: 139.7732, lat: 35.6984, roma: 'Akihabara' },
    { name: '御徒町', lon: 139.7747, lat: 35.7075, roma: 'Okachimachi' },
    { name: '上野', lon: 139.777, lat: 35.7138, roma: 'Ueno', groupId: 'g-ueno' },
    { name: '鶯谷', lon: 139.7787, lat: 35.7206, roma: 'Uguisudani' },
    { name: '日暮里', lon: 139.7707, lat: 35.7281, roma: 'Nippori' },
    { name: '西日暮里', lon: 139.7669, lat: 35.732, roma: 'Nishi-Nippori' },
    { name: '田端', lon: 139.7609, lat: 35.738, roma: 'Tabata' },
    { name: '駒込', lon: 139.748, lat: 35.7365, roma: 'Komagome' },
    { name: '巣鴨', lon: 139.7393, lat: 35.7335, roma: 'Sugamo' },
    { name: '大塚', lon: 139.7286, lat: 35.7314, roma: 'Otsuka' },
    { name: '池袋', lon: 139.711, lat: 35.7295, roma: 'Ikebukuro' },
    { name: '目白', lon: 139.7065, lat: 35.7211, roma: 'Mejiro' },
    { name: '高田馬場', lon: 139.7036, lat: 35.7126, roma: 'Takadanobaba' },
    { name: '新大久保', lon: 139.7, lat: 35.7013, roma: 'Shin-Okubo' },
    { name: '新宿', lon: 139.7004, lat: 35.6896, roma: 'Shinjuku', groupId: 'g-shinjuku' },
    { name: '代々木', lon: 139.702, lat: 35.683, roma: 'Yoyogi' },
    { name: '原宿', lon: 139.7027, lat: 35.6702, roma: 'Harajuku' },
    { name: '渋谷', lon: 139.7016, lat: 35.658, roma: 'Shibuya', groupId: 'g-shibuya' },
    { name: '恵比寿', lon: 139.71, lat: 35.6467, roma: 'Ebisu' },
    { name: '目黒', lon: 139.7158, lat: 35.6333, roma: 'Meguro' },
    { name: '五反田', lon: 139.7233, lat: 35.6262, roma: 'Gotanda' },
    { name: '大崎', lon: 139.7286, lat: 35.6197, roma: 'Osaki' },
    { name: '品川', lon: 139.7387, lat: 35.6285, roma: 'Shinagawa', groupId: 'g-shinagawa' },
    { name: '高輪ゲートウェイ', lon: 139.7407, lat: 35.6357, roma: 'Takanawa Gateway' },
    { name: '田町', lon: 139.7476, lat: 35.6457, roma: 'Tamachi' },
    { name: '浜松町', lon: 139.7574, lat: 35.6553, roma: 'Hamamatsucho' },
    { name: '新橋', lon: 139.7587, lat: 35.6665, roma: 'Shimbashi' },
    { name: '有楽町', lon: 139.7637, lat: 35.6749, roma: 'Yurakucho' },
  ],
};

// 東海道新幹線 — HSR, 17 stations (golden line: HSR, %HSR denominator).
const TOKAIDO_SHINKANSEN: LineSeed = {
  lineId: 'jr-tokaido-shinkansen',
  name: '東海道新幹線',
  country: 'JP',
  isHSR: true,
  isLoop: false,
  nameRoma: 'Tokaido Shinkansen',
  color: '#0072BC', // Shinkansen blue
  logo: '/rail/logos/jr-tokaido-shinkansen.png',
  stations: [
    { name: '東京', lon: 139.7671, lat: 35.6812, roma: 'Tokyo', groupId: 'g-tokyo' },
    { name: '品川', lon: 139.7387, lat: 35.6285, roma: 'Shinagawa', groupId: 'g-shinagawa' },
    { name: '新横浜', lon: 139.6172, lat: 35.5079, roma: 'Shin-Yokohama' },
    { name: '小田原', lon: 139.1556, lat: 35.2563, roma: 'Odawara' },
    { name: '熱海', lon: 139.078, lat: 35.1036, roma: 'Atami' },
    { name: '三島', lon: 138.911, lat: 35.1265, roma: 'Mishima' },
    { name: '新富士', lon: 138.67, lat: 35.142, roma: 'Shin-Fuji' },
    { name: '静岡', lon: 138.389, lat: 34.9716, roma: 'Shizuoka' },
    { name: '掛川', lon: 138.014, lat: 34.769, roma: 'Kakegawa' },
    { name: '浜松', lon: 137.7345, lat: 34.7035, roma: 'Hamamatsu' },
    { name: '豊橋', lon: 137.382, lat: 34.763, roma: 'Toyohashi' },
    { name: '三河安城', lon: 137.093, lat: 34.967, roma: 'Mikawa-Anjo' },
    { name: '名古屋', lon: 136.8816, lat: 35.1709, roma: 'Nagoya' },
    { name: '岐阜羽島', lon: 136.686, lat: 35.316, roma: 'Gifu-Hashima' },
    { name: '米原', lon: 136.29, lat: 35.314, roma: 'Maibara' },
    { name: '京都', lon: 135.7585, lat: 34.9858, roma: 'Kyoto' },
    { name: '新大阪', lon: 135.5, lat: 34.733, roma: 'Shin-Osaka' },
  ],
};

// 久留里線 — single-operator JR branch, non-electrified, no internal branching.
const KURURI: LineSeed = {
  lineId: 'jr-kururi',
  name: '久留里線',
  country: 'JP',
  isHSR: false,
  isLoop: false,
  color: '#E8552D', // JR-East local orange (no logo → swatch fallback)
  stations: [
    { name: '木更津', lon: 139.9165, lat: 35.3815 },
    { name: '祇園', lon: 139.936, lat: 35.376 },
    { name: '上総清川', lon: 139.949, lat: 35.372 },
    { name: '東清川', lon: 139.961, lat: 35.368 },
    { name: '横田', lon: 139.982, lat: 35.364 },
    { name: '東横田', lon: 139.993, lat: 35.361 },
    { name: '馬来田', lon: 140.015, lat: 35.356 },
    { name: '下郡', lon: 140.026, lat: 35.35 },
    { name: '小櫃', lon: 140.041, lat: 35.342 },
    { name: '俵田', lon: 140.056, lat: 35.332 },
    { name: '久留里', lon: 140.084, lat: 35.312 },
    { name: '平山', lon: 140.102, lat: 35.29 },
    { name: '上総亀山', lon: 140.124, lat: 35.272 },
  ],
};

// 東急東横線 — private multi-segment line.
const TOKYU_TOYOKO: LineSeed = {
  lineId: 'tokyu-toyoko',
  name: '東急東横線',
  operator: '東急電鉄',
  country: 'JP',
  isHSR: false,
  isLoop: false,
  nameRoma: 'Tokyu Toyoko Line',
  color: '#DA0442', // 東急 red (no logo → swatch fallback)
  stations: [
    { name: '渋谷', lon: 139.7016, lat: 35.658, roma: 'Shibuya', groupId: 'g-shibuya' },
    { name: '代官山', lon: 139.703, lat: 35.6485, roma: 'Daikanyama' },
    { name: '中目黒', lon: 139.699, lat: 35.644, roma: 'Naka-Meguro' },
    { name: '祐天寺', lon: 139.694, lat: 35.639, roma: 'Yutenji' },
    { name: '学芸大学', lon: 139.6855, lat: 35.628, roma: 'Gakugei-Daigaku' },
    { name: '都立大学', lon: 139.684, lat: 35.621, roma: 'Toritsu-Daigaku' },
    { name: '自由が丘', lon: 139.669, lat: 35.6075, roma: 'Jiyugaoka' },
    { name: '田園調布', lon: 139.668, lat: 35.597, roma: 'Den-en-chofu' },
    { name: '多摩川', lon: 139.668, lat: 35.5895, roma: 'Tamagawa' },
    { name: '新丸子', lon: 139.661, lat: 35.581, roma: 'Shin-Maruko' },
    { name: '武蔵小杉', lon: 139.6595, lat: 35.5765, roma: 'Musashi-Kosugi' },
    { name: '元住吉', lon: 139.652, lat: 35.568, roma: 'Motosumiyoshi' },
    { name: '日吉', lon: 139.647, lat: 35.5545, roma: 'Hiyoshi' },
    { name: '綱島', lon: 139.633, lat: 35.536, roma: 'Tsunashima' },
    { name: '大倉山', lon: 139.631, lat: 35.526, roma: 'Okurayama' },
    { name: '菊名', lon: 139.6315, lat: 35.512, roma: 'Kikuna' },
    { name: '妙蓮寺', lon: 139.628, lat: 35.504, roma: 'Myorenji' },
    { name: '白楽', lon: 139.626, lat: 35.494, roma: 'Hakuraku' },
    { name: '東白楽', lon: 139.627, lat: 35.488, roma: 'Higashi-Hakuraku' },
    { name: '反町', lon: 139.628, lat: 35.479, roma: 'Tanmachi' },
    { name: '横浜', lon: 139.622, lat: 35.466, roma: 'Yokohama', groupId: 'g-yokohama' },
  ],
};

// ───────────────────────────── CHINA corridor seed ──────────────────────────

// 京沪高速铁路 — proves the schema is not Japan-shaped (T9). WGS84 only (no GCJ-02).
const JINGHU_HSR: LineSeed = {
  lineId: 'cn-jinghu-hsr',
  name: '京沪高速铁路',
  country: 'CN',
  isHSR: true,
  isLoop: false,
  color: '#C8102E', // CR HSR red
  stations: [
    { name: '北京南', lon: 116.3786, lat: 39.8652 },
    { name: '天津南', lon: 117.105, lat: 38.93 },
    { name: '济南西', lon: 116.88, lat: 36.63 },
    { name: '泰安', lon: 117.07, lat: 36.18 },
    { name: '曲阜东', lon: 117.06, lat: 35.59 },
    { name: '徐州东', lon: 117.28, lat: 34.26 },
    { name: '蚌埠南', lon: 117.33, lat: 32.91 },
    { name: '南京南', lon: 118.797, lat: 31.969 },
    { name: '镇江南', lon: 119.425, lat: 32.133 },
    { name: '无锡东', lon: 120.42, lat: 31.59 },
    { name: '苏州北', lon: 120.64, lat: 31.42 },
    { name: '昆山南', lon: 120.95, lat: 31.38 },
    { name: '上海虹桥', lon: 121.32, lat: 31.194 },
  ],
};

// Fixed timestamp — the stub must be deterministic (no Date.now()).
const STUB_GENERATED_AT = '2025-04-01T00:00:00.000Z';

/**
 * UNMISTAKABLY SYNTHETIC version pin for the stub packages. This must NEVER collide with a real
 * shipped data version: the stub used to claim '2025.1.0', which is a REAL JP version with a live
 * 2025.1.0→2025.2.0 migration — so rides marked while booted on the stub could be dragged through
 * a real migration chain (or quarantined as "abolished") once the real package arrived. No real
 * migration chain will ever claim '0.0.0-stub' as a fromVersion; store.ts recognizes this pin and
 * re-resolves stub-marked rides against the real package BY segmentId (ids are deterministic /
 * content-addressed) instead of feeding them to the migration runner or the quarantine view.
 */
export const STUB_VERSION = '0.0.0-stub';

export const JP_PACKAGE: RailGeoPackage = assemble(STUB_VERSION, 'JP', STUB_GENERATED_AT, [
  YAMANOTE,
  TOKAIDO_SHINKANSEN,
  KURURI,
  TOKYU_TOYOKO,
]);

export const CN_PACKAGE: RailGeoPackage = assemble(STUB_VERSION, 'CN', STUB_GENERATED_AT, [
  JINGHU_HSR,
]);

/** Every stub package (JP first, then the CN corridor). */
export const STUB_PACKAGES: RailGeoPackage[] = [JP_PACKAGE, CN_PACKAGE];

/** Convenience lookups used by tests and dev seeding. */
export function stationByName(pkg: RailGeoPackage, lineId: string, name: string): RailStation {
  const st = pkg.stations.find((s) => s.lineId === lineId && s.name === name);
  if (!st) throw new Error(`stub: no station "${name}" on ${lineId}`);
  return st;
}
