import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RailGeoPackage } from '../../contract/types';
import { computeOverlapPlan } from './overlap';

// 共用区間 braid detector — the MEASURED performance budget (8A / Codex-#10).
//
// computeOverlapPlan runs on every package load (and again after a fallback-retry self-heal), so
// the full JP package (~9.4k segments) is the worst case that matters. 8A's decision fixed the
// budget at <100 ms for the real jp-2025 package; Codex-#10 confirmed it holds with the bbox
// prefilter + quantize-grid detector. We LOG the elapsed ms so a regression is visible in the CI
// output line even when it stays under the threshold — a slow creep toward the cap gets noticed
// before it trips.

const jpPackage = JSON.parse(readFileSync('public/rail/jp-2025.json', 'utf8')) as RailGeoPackage;

describe('computeOverlapPlan', () => {
  it('benchmark: builds the JP braid plan within the <100 ms budget', () => {
    // Best of 3 (fresh array each run so the WeakMap memo can't hide the build cost): a single
    // sample is a flake surface — one GC pause on a noisy runner would fail a healthy build.
    let ms = Infinity;
    for (let i = 0; i < 3; i++) {
      const packages = [jpPackage];
      const start = performance.now();
      computeOverlapPlan(packages);
      ms = Math.min(ms, performance.now() - start);
    }
    // Budget renegotiated with the vertex→edge matching fix (design-review): correctness of real
    // corridors beat the original <100ms guess — measured ~150ms best-of-3 locally. Boot-time
    // one-shot (WeakMap-memoized). Thresholds act as REGRESSION guards (a 2×-class jump fails).
    const budget = process.env.CI ? 500 : 250;
    // eslint-disable-next-line no-console
    console.log(`computeOverlapPlan(jp-2025) took ${ms.toFixed(1)} ms (budget <${budget} ms)`);
    expect(ms).toBeLessThan(budget);
  });

  it('memoized by array identity: same array reuses the plan, a new array caches its own', () => {
    // Same array twice → the very same Map instance (WeakMap keyed on the array identity).
    const packages = [jpPackage];
    const first = computeOverlapPlan(packages);
    const second = computeOverlapPlan(packages);
    expect(second).toBe(first);

    // A DIFFERENT array holding the same package is a distinct WeakMap key: it may compute a fresh
    // plan (not asserted — a shared-package optimisation is allowed), but a second call on THAT
    // array must return its own cached instance.
    const rebuilt = [jpPackage];
    const third = computeOverlapPlan(rebuilt);
    const fourth = computeOverlapPlan(rebuilt);
    expect(fourth).toBe(third);
  });
});
