import { describe, it, expect } from 'vitest';
import { companyLabel, companyFor } from './company';

describe('companyLabel', () => {
  it('maps long JR formal names to JRxx', () => {
    expect(companyLabel('東日本旅客鉄道')).toBe('JR東日本');
    expect(companyLabel('西日本旅客鉄道')).toBe('JR西日本');
    expect(companyLabel('九州旅客鉄道')).toBe('JR九州');
  });

  it('maps subways/municipals to short JP labels (no mixed English)', () => {
    expect(companyLabel('東京地下鉄')).toBe('東京メトロ');
    expect(companyLabel('大阪市高速電気軌道')).toBe('大阪メトロ');
    expect(companyLabel('東京都')).toBe('都営');
  });

  it('maps major private operators to their brand short form', () => {
    expect(companyLabel('東急電鉄')).toBe('東急');
    expect(companyLabel('近畿日本鉄道')).toBe('近鉄');
    expect(companyLabel('京浜急行電鉄')).toBe('京急');
  });

  it('collapses the long Sapporo tram entity to 札幌市電', () => {
    expect(companyLabel('一般社団法人札幌市交通事業振興公社')).toBe('札幌市電');
  });

  it('strips legal noise from unmapped operators', () => {
    expect(companyLabel('一般財団法人青函トンネル記念館')).toBe('青函トンネル記念館');
  });

  it('passes through already-short 3rd-sector names', () => {
    expect(companyLabel('いすみ鉄道')).toBe('いすみ鉄道');
    expect(companyLabel('しなの鉄道')).toBe('しなの鉄道');
  });

  it('returns empty for missing operator', () => {
    expect(companyLabel(undefined)).toBe('');
    expect(companyLabel('')).toBe('');
  });
});

describe('companyFor (de-dup)', () => {
  it('shows the company when the line name does not lead with the brand', () => {
    expect(companyFor('東日本旅客鉄道', '山手線')).toBe('JR東日本');
    expect(companyFor('東急電鉄', '東横線')).toBe('東急');
  });

  it('suppresses the company when the line name already leads with the brand', () => {
    expect(companyFor('東急電鉄', '東急東横線')).toBe('');
    expect(companyFor('しなの鉄道', 'しなの鉄道線')).toBe('');
  });

  it('suppresses when the name starts with the raw formal operator', () => {
    expect(companyFor('愛知環状鉄道', '愛知環状鉄道線')).toBe('');
  });

  it('returns empty for missing operator', () => {
    expect(companyFor(undefined, '山手線')).toBe('');
  });
});
