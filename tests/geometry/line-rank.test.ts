import test from 'node:test';
import assert from 'node:assert/strict';
import { assignRailLineRank } from '../../pipeline/line-rank.ts';

test('line rank rules apply in the documented order', () => {
  assert.equal(assignRailLineRank({
    operator: '東海旅客鉄道',
    name: '東海道新幹線',
    isHSR: true,
    stationCount: 17,
    km: 515,
  }), 0, 'HSR is tier 0');

  assert.equal(assignRailLineRank({
    operator: '東日本旅客鉄道',
    name: '中央線',
    isHSR: false,
    stationCount: 70,
    km: 222,
  }), 2, 'override wins before JR trunk heuristic');

  assert.equal(assignRailLineRank({
    operator: '東海旅客鉄道',
    name: '東海道線',
    isHSR: false,
    stationCount: 85,
    km: 341,
  }), 1, 'curated JR trunk is tier 1');

  assert.equal(assignRailLineRank({
    operator: '近畿日本鉄道',
    name: '大阪線',
    isHSR: false,
    stationCount: 48,
    km: 107,
  }), 1, 'major private intercity flagship is tier 1');

  assert.equal(assignRailLineRank({
    operator: '東日本旅客鉄道',
    name: '只見線',
    isHSR: false,
    stationCount: 36,
    km: 135,
  }), 3, 'long rural JR line is not promoted by distance');

  assert.equal(assignRailLineRank({
    operator: '広島電鉄',
    name: '本線',
    isHSR: false,
    stationCount: 19,
    km: 5.2,
  }), 4, 'tram operator is tier 4');

  assert.equal(assignRailLineRank({
    operator: '東京都',
    name: '荒川線',
    isHSR: false,
    stationCount: 30,
    km: 12,
  }), 4, 'streetcar override wins before municipal subway detection');
});
