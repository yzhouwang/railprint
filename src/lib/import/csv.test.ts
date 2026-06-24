import { describe, it, expect } from 'vitest';
import { parseCsv, stringifyCsv } from './csv';

describe('parseCsv', () => {
  it('parses a simple grid', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles CRLF, LF, and bare CR row terminators', () => {
    expect(parseCsv('a,b\r\n1,2\n3,4\r5,6')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
      ['5', '6'],
    ]);
  });

  it('does not emit a phantom trailing row for a trailing newline', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('preserves an intentional empty trailing field', () => {
    expect(parseCsv('a,b,\n1,2,')).toEqual([
      ['a', 'b', ''],
      ['1', '2', ''],
    ]);
  });

  it('quoted fields may contain commas, quotes, and embedded newlines', () => {
    const csv = '路線,駅\n"山手線, 環状","渋谷\n""ハチ公"""';
    expect(parseCsv(csv)).toEqual([
      ['路線', '駅'],
      ['山手線, 環状', '渋谷\n"ハチ公"'],
    ]);
  });

  it('strips a leading UTF-8 BOM (Windows incumbent exports)', () => {
    expect(parseCsv('﻿路線,駅\n山手線,渋谷')).toEqual([
      ['路線', '駅'],
      ['山手線', '渋谷'],
    ]);
  });

  it('returns empty for an empty string', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

describe('stringifyCsv', () => {
  it('round-trips with parseCsv', () => {
    const rows = [
      ['路線', '駅', 'メモ'],
      ['山手線, 環状', '渋谷\n"ハチ公"', ''],
      ['東海道新幹線', '東京', 'のぞみ'],
    ];
    expect(parseCsv(stringifyCsv(rows))).toEqual(rows);
  });

  it('quotes only cells that need it and uses CRLF', () => {
    expect(stringifyCsv([['a', 'b,c'], ['1', '2']])).toBe('a,"b,c"\r\n1,2');
  });

  it('coerces null/undefined/number cells', () => {
    expect(stringifyCsv([[null, undefined, 3]])).toBe(',,3');
  });
});
