// Administrative-region assignment for the CoverageResult.prefectures count.
//
// ⚠ CONTRACT GAP (flag to steering): RailStation in the frozen contract carries no
// prefecture/province field, yet CoverageResult.prefectures is required. Until the
// RailGeoPackage tags each station with its admin region, the resolver derives the
// region by NEAREST CENTROID of a station's lon/lat. This is a v0 approximation: it is
// deterministic and gives a believable distinct-region count, but it can misclassify
// stations near a prefectural border. Real per-station admin tagging belongs in the
// package (a `prefecture` field on RailStation), at which point this file is deleted.

import type { Country } from '../contract/types';

interface Region {
  name: string;
  lon: number;
  lat: number;
}

// 47 都道府県 — approximate geographic centroids (lon, lat).
const JP_PREFECTURES: Region[] = [
  { name: '北海道', lon: 142.8, lat: 43.4 },
  { name: '青森県', lon: 140.7, lat: 40.8 },
  { name: '岩手県', lon: 141.2, lat: 39.6 },
  { name: '宮城県', lon: 140.9, lat: 38.4 },
  { name: '秋田県', lon: 140.4, lat: 39.7 },
  { name: '山形県', lon: 140.2, lat: 38.5 },
  { name: '福島県', lon: 140.3, lat: 37.4 },
  { name: '茨城県', lon: 140.4, lat: 36.3 },
  { name: '栃木県', lon: 139.8, lat: 36.7 },
  { name: '群馬県', lon: 138.9, lat: 36.5 },
  { name: '埼玉県', lon: 139.5, lat: 36.0 },
  { name: '千葉県', lon: 140.2, lat: 35.5 },
  { name: '東京都', lon: 139.5, lat: 35.7 },
  { name: '神奈川県', lon: 139.4, lat: 35.4 },
  { name: '新潟県', lon: 138.9, lat: 37.5 },
  { name: '富山県', lon: 137.2, lat: 36.6 },
  { name: '石川県', lon: 136.7, lat: 36.8 },
  { name: '福井県', lon: 136.3, lat: 35.9 },
  { name: '山梨県', lon: 138.6, lat: 35.6 },
  { name: '長野県', lon: 138.0, lat: 36.2 },
  { name: '岐阜県', lon: 137.0, lat: 35.7 },
  { name: '静岡県', lon: 138.2, lat: 34.9 },
  { name: '愛知県', lon: 137.2, lat: 35.0 },
  { name: '三重県', lon: 136.4, lat: 34.5 },
  { name: '滋賀県', lon: 136.1, lat: 35.2 },
  { name: '京都府', lon: 135.6, lat: 35.2 },
  { name: '大阪府', lon: 135.5, lat: 34.6 },
  { name: '兵庫県', lon: 134.8, lat: 35.0 },
  { name: '奈良県', lon: 135.9, lat: 34.3 },
  { name: '和歌山県', lon: 135.4, lat: 34.0 },
  { name: '鳥取県', lon: 133.9, lat: 35.4 },
  { name: '島根県', lon: 132.6, lat: 35.0 },
  { name: '岡山県', lon: 133.8, lat: 34.9 },
  { name: '広島県', lon: 132.8, lat: 34.6 },
  { name: '山口県', lon: 131.5, lat: 34.2 },
  { name: '徳島県', lon: 134.3, lat: 34.0 },
  { name: '香川県', lon: 134.0, lat: 34.3 },
  { name: '愛媛県', lon: 132.9, lat: 33.8 },
  { name: '高知県', lon: 133.4, lat: 33.5 },
  { name: '福岡県', lon: 130.6, lat: 33.6 },
  { name: '佐賀県', lon: 130.1, lat: 33.3 },
  { name: '長崎県', lon: 129.8, lat: 32.9 },
  { name: '熊本県', lon: 130.8, lat: 32.6 },
  { name: '大分県', lon: 131.4, lat: 33.2 },
  { name: '宮崎県', lon: 131.4, lat: 32.0 },
  { name: '鹿児島県', lon: 130.6, lat: 31.6 },
  { name: '沖縄県', lon: 127.9, lat: 26.5 },
];

// Provinces / municipalities along the 京沪 corridor (and nearby) — approximate centroids.
const CN_REGIONS: Region[] = [
  { name: '北京市', lon: 116.4, lat: 39.9 },
  { name: '天津市', lon: 117.2, lat: 39.1 },
  { name: '河北省', lon: 115.5, lat: 38.0 },
  { name: '山东省', lon: 118.0, lat: 36.4 },
  { name: '安徽省', lon: 117.2, lat: 31.8 },
  { name: '江苏省', lon: 119.8, lat: 33.0 },
  { name: '上海市', lon: 121.5, lat: 31.2 },
];

// Squared planar distance is monotonic with great-circle distance over the small spans
// here, and cheaper — fine for a nearest-centroid bucket.
function nearestRegionName(lon: number, lat: number, table: Region[]): string {
  let best = table[0];
  let bestD = Infinity;
  for (const r of table) {
    const d = (r.lon - lon) ** 2 + (r.lat - lat) ** 2;
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best.name;
}

/** Approximate admin region for a station point (see file header caveat). */
export function regionFor(lon: number, lat: number, country: Country): string {
  return nearestRegionName(lon, lat, country === 'CN' ? CN_REGIONS : JP_PREFECTURES);
}
