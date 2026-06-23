import { describe, expect, it } from 'vitest';
import { haversineKm } from './geo';

describe('haversineKm', () => {
  it('is zero for the same point', () => {
    expect(haversineKm({ lon: 139.767, lat: 35.681 }, { lon: 139.767, lat: 35.681 })).toBe(0);
  });

  it('matches the known Tokyo→Shin-Osaka great-circle distance (~400 km)', () => {
    const km = haversineKm({ lon: 139.767, lat: 35.681 }, { lon: 135.5, lat: 34.733 });
    expect(km).toBeGreaterThan(390);
    expect(km).toBeLessThan(410);
  });

  it('is symmetric', () => {
    const a = { lon: 139.767, lat: 35.681 };
    const b = { lon: 135.5, lat: 34.733 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
  });

  it('is ~111 km for one degree of latitude at the equator', () => {
    const km = haversineKm({ lon: 0, lat: 0 }, { lon: 0, lat: 1 });
    expect(km).toBeGreaterThan(110);
    expect(km).toBeLessThan(112);
  });
});
