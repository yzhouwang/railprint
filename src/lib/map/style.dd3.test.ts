// DD3 FAIL-SAFE — the contract the whole braid design rests on: a detector exception must
// degrade to the pre-braid render, never a broken map. vi.mock is hoisted per-module, so this
// lives in its own file (style.test.ts needs the REAL detector).
import { describe, it, expect, vi } from 'vitest';

vi.mock('./overlap', () => ({
  computeOverlapPlan: (): never => {
    throw new Error('detector boom (poisoned package)');
  },
}));

import { buildSegmentCollection } from './style';
import { JP_PACKAGE } from '../fallback-package';

describe('DD3 fail-safe: the braid can never break the map', () => {
  it('a throwing detector degrades to one plain feature per segment (unbraided render) + warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fc = buildSegmentCollection([JP_PACKAGE]);
    expect(fc.features).toHaveLength(JP_PACKAGE.segments.length);
    for (const f of fc.features) {
      expect('slot' in f.properties).toBe(false);
      expect('partnerSeg' in f.properties).toBe(false);
    }
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('overlap detector failed'), expect.any(Error));
    warn.mockRestore();
  });
});
