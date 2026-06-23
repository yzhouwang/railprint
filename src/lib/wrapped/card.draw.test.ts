import { describe, it, expect } from 'vitest';
import { drawWrappedCard, buildWrappedData, CARD_W, CARD_H } from './card';

// A recording mock 2D context: every method/property the card uses must exist or this
// throws "is not a function" — catching canvas-API typos jsdom can't (no real ctx).
function mockCtx() {
  const calls: string[] = [];
  const handler: ProxyHandler<any> = {
    get(_t, prop: string) {
      if (prop === '__calls') return calls;
      // measureText must return an object with .width
      if (prop === 'measureText')
        return (s: string) => {
          calls.push('measureText');
          return { width: String(s).length * 10 };
        };
      // any other accessed member is a recording no-op function or settable property
      return (...args: unknown[]) => {
        calls.push(prop + '(' + args.length + ')');
      };
    },
    set() {
      return true; // fillStyle/font/lineWidth/etc. assignments
    },
  };
  return new Proxy({}, handler) as unknown as CanvasRenderingContext2D & { __calls: string[] };
}

describe('drawWrappedCard smoke (mock 2D context)', () => {
  it('runs the full draw path without throwing, populated', () => {
    const ctx = mockCtx() as any;
    const data = buildWrappedData({
      headline: {
        riddenKm: 1234.5,
        totalKm: 30000,
        pctNational: 41,
        hsrRiddenKm: 552,
        hsrTotalKm: 3000,
        pctHSR: 18,
        prefectures: 12,
        byCountry: {},
        hasRides: true,
      },
      coverages: [
        {
          result: {
            riddenKm: 1234.5,
            totalKm: 30000,
            pctNational: 41,
            hsrRiddenKm: 552,
            hsrTotalKm: 3000,
            pctHSR: 18,
            litSegmentIds: [],
            prefectures: 12,
            longestRide: { fromStationId: 'a', toStationId: 'b', km: 552.6 },
            mostRiddenLineId: 'L',
            fastestTrainModel: 'N700S',
          },
        },
      ],
      geo: {
        lineById: new Map([['L', { name: '東海道新幹線' } as any]]),
        stationById: new Map([
          ['a', { name: '東京' } as any],
          ['b', { name: '新大阪' } as any],
        ]),
        segmentById: new Map(),
        linesByCountry: new Map(),
        stationsByLine: new Map(),
      },
      now: new Date('2026-06-23T00:00:00Z'),
    });
    expect(() => drawWrappedCard(ctx, data)).not.toThrow();
    const calls = (ctx as any).__calls as string[];
    expect(calls.some((c) => c.startsWith('fillText'))).toBe(true);
    expect(calls.some((c) => c.startsWith('arc'))).toBe(true); // diorama wheels
    expect(CARD_W).toBe(1080);
    expect(CARD_H).toBe(1920);
  });

  it('runs the full draw path without throwing, empty data', () => {
    const ctx = mockCtx() as any;
    const data = buildWrappedData({
      headline: {
        riddenKm: 0,
        totalKm: 0,
        pctNational: 0,
        hsrRiddenKm: 0,
        hsrTotalKm: 0,
        pctHSR: 0,
        prefectures: 0,
        byCountry: {},
        hasRides: false,
      },
      coverages: [],
      geo: {
        lineById: new Map(),
        stationById: new Map(),
        segmentById: new Map(),
        linesByCountry: new Map(),
        stationsByLine: new Map(),
      },
    });
    expect(() => drawWrappedCard(ctx, data)).not.toThrow();
  });
});
