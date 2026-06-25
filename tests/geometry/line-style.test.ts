import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPackageFromN02 } from '../../pipeline/n02-ingest.ts';
import { buildLineStyleIndex, isValidHexColor, logoCredit, logoMatchesOperatorFamily } from '../../pipeline/line-style.ts';

type Pos = [number, number];

const section = (op: string, name: string, n02_002: string, coords: Pos[]): unknown => ({
  properties: { N02_004: op, N02_003: name, N02_002: n02_002 },
  geometry: { type: 'LineString', coordinates: coords },
});

const station = (op: string, name: string, g: string, lon: number, lat: number): unknown => ({
  properties: { N02_004: op, N02_003: name, N02_005g: g, N02_005: g, display_point: [lon, lat] },
  geometry: { type: 'LineString', coordinates: [[lon, lat]] },
});

const fc = (features: unknown[]): never => ({ features } as never);

const wikiStyle = (op: string, ja: string, color: string, logo?: string) => ({
  op: { value: op },
  ja: { value: ja },
  color: { value: color },
  ...(logo ? { logo: { value: logo } } : {}),
});

test('operator-aware style join keeps JR and Osaka Metro Chuo colors distinct', () => {
  const logoSrc = 'http://commons.wikimedia.org/wiki/Special:FilePath/Osaka%20Metro%20Chuo%20line%20symbol.svg';
  const lines = [
    { operator: '東日本旅客鉄道', name: '中央線', n02_002: '2' },
    { operator: '大阪市高速電気軌道', name: '4号線(中央線)', n02_002: '2' },
  ];
  const lineStyles = buildLineStyleIndex(lines, {
    results: { bindings: [
      wikiStyle('東日本旅客鉄道', '中央線', 'E00000'),
      wikiStyle('大阪市高速電気軌道', '中央線', '019A66', logoSrc),
    ] },
  }, {
    '中央線': { file: 'logos-raw/中央線.png', src: logoSrc },
  });

  const secs = [
    section('東日本旅客鉄道', '中央線', '2', [[139.0, 35.0], [139.1, 35.0]]),
    section('大阪市高速電気軌道', '4号線(中央線)', '2', [[135.0, 34.0], [135.1, 34.0]]),
  ];
  const stns = [
    station('東日本旅客鉄道', '中央線', 'ja', 139.0, 35.0),
    station('東日本旅客鉄道', '中央線', 'jb', 139.1, 35.0),
    station('大阪市高速電気軌道', '4号線(中央線)', 'oa', 135.0, 34.0),
    station('大阪市高速電気軌道', '4号線(中央線)', 'ob', 135.1, 34.0),
  ];
  const { pkg } = buildPackageFromN02(fc(secs), fc(stns), {
    country: 'JP',
    version: 't',
    generatedAt: 't',
    lineStyles,
  });

  const jr = pkg.lines.find((l) => l.lineId === 'jp-東日本旅客鉄道-中央線')!;
  const osaka = pkg.lines.find((l) => l.lineId === 'jp-大阪市高速電気軌道-4号線(中央線)')!;
  assert.equal(jr.color, '#E00000');
  assert.equal(osaka.color, '#019A66');
  assert.notEqual(jr.color, osaka.color);
  assert.equal(osaka.logo, '/rail/logos/jp-大阪市高速電気軌道-4号線(中央線).png');
});

test('operator-default fallback gives every line a valid hex color', () => {
  const lineStyles = buildLineStyleIndex([
    { operator: '架空鉄道', name: '未収録線', n02_002: '2' },
  ], { results: { bindings: [] } });
  const style = lineStyles['架空鉄道\u0000未収録線'];
  assert.equal(style.colorSource, 'operator-default');
  assert.equal(isValidHexColor(style.color), true);
});

test('Shinkansen fallback uses line official color instead of generic JR color', () => {
  const lineStyles = buildLineStyleIndex([
    { operator: '九州旅客鉄道', name: '九州新幹線', n02_002: '1' },
  ], { results: { bindings: [] } });
  const style = lineStyles['九州旅客鉄道\u0000九州新幹線'];
  assert.equal(style.colorSource, 'shinkansen-default');
  assert.equal(style.color, '#FF0000');
});

test('logo credits use the required manifest shape', () => {
  const src = 'http://commons.wikimedia.org/wiki/Special:FilePath/Example.svg';
  const lineStyles = buildLineStyleIndex([
    { operator: 'OP', name: 'Logo線', n02_002: '2' },
  ], {
    results: { bindings: [wikiStyle('OP', 'Logo線', '123456', src)] },
  }, {
    'Logo線': { file: 'logos-raw/Logo線.png', src },
  });

  assert.deepEqual(logoCredit(lineStyles['OP\u0000Logo線']), {
    src,
    license: 'Wikimedia Commons',
  });
});

test('JR logos are picked by operator family instead of arbitrary first match', () => {
  const jre = 'http://commons.wikimedia.org/wiki/Special:FilePath/Shinkansen%20jre.svg';
  const jrw = 'http://commons.wikimedia.org/wiki/Special:FilePath/Shinkansen%20jrw.svg';
  const lineStyles = buildLineStyleIndex([
    { operator: '東日本旅客鉄道', name: '北陸新幹線', n02_002: '1' },
    { operator: '西日本旅客鉄道', name: '北陸新幹線', n02_002: '1' },
  ], {
    results: { bindings: [
      wikiStyle('東日本旅客鉄道', '北陸新幹線', '008000', jrw),
      wikiStyle('東日本旅客鉄道', '北陸新幹線', '008000', jre),
      wikiStyle('西日本旅客鉄道', '北陸新幹線', '008000', jrw),
      wikiStyle('西日本旅客鉄道', '北陸新幹線', '008000', jre),
    ] },
  }, {
    arbitraryEastName: { file: 'logos-raw/east.png', src: jre },
    arbitraryWestName: { file: 'logos-raw/west.png', src: jrw },
  });

  const east = lineStyles['東日本旅客鉄道\u0000北陸新幹線'];
  const west = lineStyles['西日本旅客鉄道\u0000北陸新幹線'];
  assert.equal(east.logoSrc, jre);
  assert.equal(east.logoFile, 'logos-raw/east.png');
  assert.equal(west.logoSrc, jrw);
  assert.equal(west.logoFile, 'logos-raw/west.png');
});

test('JR logos fail closed when no candidate matches the operator family', () => {
  const jrw = 'http://commons.wikimedia.org/wiki/Special:FilePath/Shinkansen%20jrw.svg';
  const lineStyles = buildLineStyleIndex([
    { operator: '東日本旅客鉄道', name: '北陸新幹線', n02_002: '1' },
  ], {
    results: { bindings: [
      wikiStyle('東日本旅客鉄道', '北陸新幹線', '008000', jrw),
    ] },
  }, {
    arbitraryWestName: { file: 'logos-raw/west.png', src: jrw },
  });

  const style = lineStyles['東日本旅客鉄道\u0000北陸新幹線'];
  assert.equal(style.logoSrc, undefined);
  assert.equal(style.logoFile, undefined);
});

test('non-JR logos use deterministic src-indexed pick and color tiebreak', () => {
  const b = 'http://commons.wikimedia.org/wiki/Special:FilePath/Private%20B.svg';
  const a = 'http://commons.wikimedia.org/wiki/Special:FilePath/Private%20A.svg';
  const missing = 'http://commons.wikimedia.org/wiki/Special:FilePath/Private%200.svg';
  const lineStyles = buildLineStyleIndex([
    { operator: '私鉄', name: '私鉄線', n02_002: '2' },
  ], {
    results: { bindings: [
      wikiStyle('私鉄', '私鉄線', 'BBBBBB', b),
      wikiStyle('私鉄', '私鉄線', 'AAAAAA', a),
      wikiStyle('私鉄', '私鉄線', 'CCCCCC', missing),
    ] },
  }, {
    bName: { file: 'logos-raw/b.png', src: b },
    aName: { file: 'logos-raw/a.png', src: a },
  });

  const style = lineStyles['私鉄\u0000私鉄線'];
  assert.equal(style.color, '#AAAAAA');
  assert.equal(style.logoSrc, a);
  assert.equal(style.logoFile, 'logos-raw/a.png');
});

test('operator family matching uses decoded Commons filenames', () => {
  assert.equal(
    logoMatchesOperatorFamily('東日本旅客鉄道', 'http://commons.wikimedia.org/wiki/Special:FilePath/JR%20JY%20line%20symbol.svg'),
    true,
  );
  assert.equal(
    logoMatchesOperatorFamily('東日本旅客鉄道', 'http://commons.wikimedia.org/wiki/Special:FilePath/JRW%20kinki-O.svg'),
    false,
  );
});
