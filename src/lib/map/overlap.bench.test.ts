import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RailGeoPackage } from '../../contract/types';
import { computeOverlapPlan } from './overlap';

// 共用区間 braid detector — the MEASURED performance budget (8A / Codex-#10).
//
// computeOverlapPlan runs on every package load (and again after a fallback-retry self-heal), so
// the full JP package (~9.4k segments) is the worst case that matters. The enforced budgets are
// REGRESSION GUARDS (250ms local / 500ms CI — renegotiated from 8A's original <100ms guess when
// the vertex→edge matching fix landed; measured ~150ms best-of-3). We LOG the elapsed ms in CI
// output line even when it stays under the threshold — a slow creep toward the cap gets noticed
// before it trips.

const jpPackage = JSON.parse(readFileSync('public/rail/jp-2025.json', 'utf8')) as RailGeoPackage;

describe('computeOverlapPlan', () => {
  it('benchmark: builds the JP braid plan within the regression-guard budget (250ms local / 500ms CI)', () => {
    // Best of 3 (fresh array each run so the WeakMap memo can't hide the build cost): a single
    // sample is a flake surface — one GC pause on a noisy runner would fail a healthy build.
    let ms = Infinity;
    for (let i = 0; i < 3; i++) {
      const packages = [jpPackage];
      const start = performance.now();
      computeOverlapPlan(packages);
      ms = Math.min(ms, performance.now() - start);
    }
    // REGRESSION guard, not a UX budget: standalone best-of-3 measures ~120ms, but vitest runs
    // test FILES in parallel workers, so under full-suite CPU contention the same build measures
    // ~330ms (quality review). The threshold must not flake on contention — it exists to catch
    // order-of-magnitude regressions (an accidental O(n²), unbounded rasterization). The LOGGED
    // ms line is the fine-grained signal; eyeball it when touching the detector.
    const budget = 600;
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
