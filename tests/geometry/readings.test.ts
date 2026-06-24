import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReadings, normalizeRomaji } from '../../pipeline/build-readings.ts';

type Pos = [number, number];

const n02Station = (id: string, name: string, lon: number, lat: number, op = 'OP', line = 'L') => ({
  properties: { N02_005g: id, N02_005: name, N02_004: op, N02_003: line, display_point: [lon, lat] },
});

const osmStation = (name: string, romaji: string, lon: number, lat: number) => ({
  lat,
  lon,
  tags: { name, 'name:en': romaji },
});

const wikiStation = (label: string, [lon, lat]: Pos) => ({
  coord: { value: `Point(${lon} ${lat})` },
  en: { value: label },
});

const wikiLine = (ja: string, en: string) => ({
  ja: { value: ja },
  en: { value: en },
});

test('normalizes station romaji display names', () => {
  assert.equal(normalizeRomaji('Zōshigaya Station'), 'Zoshigaya');
  assert.equal(normalizeRomaji('shin-kōyasu'), 'Shin-Koyasu');
  assert.equal(normalizeRomaji('JR Fujinomori'), 'JR Fujinomori');
});

test('exact Japanese-name match uses nearest OSM node within 700m', () => {
  const result = buildReadings({
    n02Stations: { features: [n02Station('n', '日暮里', 139.77119, 35.72799)] },
    osmStations: { elements: [
      osmStation('日暮里', 'Wrong-Far', 140.5, 35.7),
      osmStation('日暮里', 'Nippori', 139.7712, 35.728),
    ] },
    wikidataStations: { results: { bindings: [] } },
  });
  assert.deepEqual(result.stationReadings.n, { romaji: 'Nippori', source: 'osm' });
  assert.equal(result.stats.tier1, 1);
});

test('same Japanese name is disambiguated by nearest coordinates', () => {
  const result = buildReadings({
    n02Stations: { features: [
      n02Station('godo', '神戸', 139.356565, 36.537505, 'Watarase', 'W'),
      n02Station('kobe', '神戸', 135.17822, 34.67922, 'JR West', 'Sanyo'),
      n02Station('kambe', '神戸', 137.27737, 34.66799, 'Toyohashi', 'Atsumi'),
    ] },
    osmStations: { elements: [
      osmStation('神戸', 'Kobe', 135.17822, 34.67922),
      osmStation('神戸', 'Godo', 139.356565, 36.537505),
      osmStation('神戸', 'Kambe', 137.27737, 34.66799),
    ] },
    wikidataStations: { results: { bindings: [] } },
  });
  assert.equal(result.stationReadings.godo.romaji, 'Godo');
  assert.equal(result.stationReadings.kobe.romaji, 'Kobe');
  assert.equal(result.stationReadings.kambe.romaji, 'Kambe');
});

test('Wikidata fill strips English Station suffix', () => {
  const result = buildReadings({
    n02Stations: { features: [n02Station('wd', '架空駅', 139.0, 35.0)] },
    osmStations: { elements: [] },
    wikidataStations: { results: { bindings: [wikiStation('Kakuu Station', [139.0001, 35.0001])] } },
  });
  assert.deepEqual(result.stationReadings.wd, { romaji: 'Kakuu', source: 'wikidata' });
  assert.equal(result.stats.wikidata, 1);
});

test('manual override wins after automatic matches', () => {
  const result = buildReadings({
    n02Stations: { features: [n02Station('x', '放出', 135.56313, 34.688)] },
    osmStations: { elements: [osmStation('放出', 'Bad Guess', 135.56313, 34.688)] },
    wikidataStations: { results: { bindings: [] } },
    overrides: { stations: { x: { romaji: 'Hanaten' } } },
  });
  assert.deepEqual(result.stationReadings.x, { romaji: 'Hanaten', source: 'manual' });
});

test('tier-2 spatial-only path fills close unmatched names and marks review', () => {
  const result = buildReadings({
    n02Stations: { features: [n02Station('spatial', '名前が違う', 135.0, 35.0)] },
    osmStations: { elements: [osmStation('Nearby OSM Name', 'Nearby', 135.0001, 35.0001)] },
    wikidataStations: { results: { bindings: [] } },
  });
  assert.deepEqual(result.stationReadings.spatial, { romaji: 'Nearby', source: 'osm' });
  assert.equal(result.stats.tier2, 1);
  assert.equal(result.reviewRows[0].confidence, 'tier2-spatial');
});

test('line readings join exact normalized Wikidata labels and keep curated overrides', () => {
  const result = buildReadings({
    n02Stations: { features: [
      n02Station('s1', 'A', 135.0, 35.0, '東日本旅客鉄道', '山手線'),
      n02Station('s2', 'B', 135.1, 35.1, 'JR West', '架空線'),
      n02Station('s3', 'C', 135.2, 35.2, 'JR West', '短線'),
    ] },
    osmStations: { elements: [] },
    wikidataStations: { results: { bindings: [] } },
    wikidataLines: { results: { bindings: [
      wikiLine('山手線（JR東日本）', 'Wrong Wikidata Yamanote'),
      wikiLine('架空線 (Example)', 'Longer Fictional Railway Line'),
      wikiLine('架空線', 'Fictional Line'),
      wikiLine('短線', 'Longer Short Line'),
      wikiLine('短線', 'Short Line'),
    ] } },
  });

  assert.equal(result.lineReadings['東日本旅客鉄道\u0000山手線'], 'Yamanote Line');
  assert.equal(result.lineReadings['JR West\u0000架空線'], 'Fictional Line');
  assert.equal(result.lineReadings['JR West\u0000短線'], 'Short Line');
});
