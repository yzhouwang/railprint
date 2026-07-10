// T8 — the Wrapped <canvas> share card. The flex artifact.
//
// Two concerns, deliberately split:
//   1. buildWrappedData(...) — PURE. Shapes headline + per-package coverage + the geo
//      index into display-ready strings/numbers (resolving stationId/lineId → names,
//      picking the cross-package superlatives). Unit-tested; no canvas, no DOM.
//   2. drawWrappedCard(ctx, data) / renderWrappedToBlob(data) — the canvas painting. Not
//      unit-tested under jsdom (no real 2D context); kept thin and declarative.
//
// Visual spec (DESIGN.md): emerald monochrome, folder-tab framing, a soft toy Shinkansen
// diorama (mirrors Diorama.svelte), big 700-weight display numbers. Vertical share size.

import type { CoverageResult } from '../../contract/types';
import { tokens } from '../../design/tokens';
import type { GeoIndex } from '../geo-index';
import type { Headline } from '../store';
import type { CollectionSummary } from '../collection';
import { topSpeedKmh } from '../train-models';
import { CANVAS_FONT_FAMILY, ensureWrappedFonts } from './font';

/**
 * D10 smoke gate: `true` ships the 4th superlative row (記録した車両). The canvas is a FIXED
 * 1080×1920 — if the visual smoke shows the extra row crowding it, flip to `false`, which
 * ships the PRE-APPROVED fallback instead (a `NNN km/h` sub enriching the existing 最速の車両
 * row, zero layout risk). Both branches stay implemented and unit-tested regardless.
 */
export const WRAPPED_VEHICLE_ROW = true;

// ───────────────────────────── pure data shaping ────────────────────────────

/** One headline stat: a big number + its unit + a muted caption. */
export interface WrappedStat {
  value: string; // already formatted (locale digits, %, etc.)
  unit: string; // 'km' | '%' | '都道府県' | ''
  caption: string;
}

/** One superlative row: a label, a primary value, and an optional sub-line. */
export interface WrappedSuperlative {
  label: string; // e.g. '最長乗車'
  value: string; // e.g. '東京 → 新大阪'
  sub?: string; // e.g. '552.6 km'
}

/** Everything the canvas needs — fully resolved, no ids, no NaN. */
export interface WrappedData {
  totalKm: number; // for the headline km number (rounded by formatter)
  stats: WrappedStat[]; // top hero stats row(s)
  superlatives: WrappedSuperlative[]; // the "your year in rail" rows
  generatedLabel: string; // small footer date, locale-formatted
}

/** Inputs the pure shaper consumes. `coverages` mirrors the store's PackageCoverage[]. */
export interface WrappedInputs {
  headline: Headline;
  coverages: { result: CoverageResult }[];
  geo: GeoIndex;
  /** v0.13 車両図鑑 rollup — OPTIONAL so the builder stays pure/sync and old callers/tests
   *  are untouched (the iOS-gesture share path passes a store snapshot, never awaits). */
  collection?: CollectionSummary;
  /** Injected for determinism in tests; defaults to now. */
  now?: Date;
}

const fmtInt = (n: number): string => Math.round(n).toLocaleString('en-US');
const fmtKm = (n: number): string => {
  // Show one decimal for sub-100 distances (a single short ride reads as "12.4 km"),
  // whole thousands-separated km above that. Never produce NaN.
  if (!Number.isFinite(n) || n <= 0) return '0';
  return n < 100 ? n.toFixed(1) : fmtInt(n);
};
const fmtPct = (n: number): string => (Number.isFinite(n) ? String(Math.round(n)) : '0');

function stationName(geo: GeoIndex, id: string): string {
  return geo.stationById.get(id)?.name ?? id;
}
function lineName(geo: GeoIndex, id: string): string {
  return geo.lineById.get(id)?.name ?? id;
}

/**
 * Pick the single best superlative of each kind across every loaded package and resolve
 * its ids to human names. Cross-package "longest ride" = the longest by km; "most-ridden
 * line" = the line with the most ridden km (we re-pick across packages by comparing the
 * per-package winners' km via the line's ridden share — but CoverageResult only exposes
 * the lineId, so across packages we take the first package that HAS one, JP-first, which
 * matches the store's package order). This is intentionally simple: the stub + v0 ship a
 * single dominant package, and the contract gives us a per-package winner, not a global
 * km-by-line map. Documented so the lead can tighten it if multi-package stats matter.
 */
export function buildWrappedData(
  inputs: WrappedInputs,
  opts?: { vehicleRow?: boolean }, // test seam so BOTH D10 branches stay unit-tested (9A#3)
): WrappedData {
  const vehicleRow = opts?.vehicleRow ?? WRAPPED_VEHICLE_ROW;
  const { headline, coverages, geo } = inputs;
  const now = inputs.now ?? new Date();

  // ── hero stats (always defined; zero-safe) ──
  // The % is the JAPAN figure, never the JP+China blend — the share card must not report a
  // misleading "全国 %". km/prefectures stay cross-country sums (legit totals, not percentages).
  const jp = headline.byCountry.JP;
  const cn = headline.byCountry.CN;
  // The hero % belongs to the country you've actually ridden: JP when it has rides, else the CN
  // corridor for a China-only rider — never a misleading JP 0% and never the JP+CN blend.
  const primary = jp && jp.riddenKm > 0 ? jp : cn && cn.riddenKm > 0 ? cn : jp;
  const stats: WrappedStat[] = [
    { value: fmtPct(primary?.pctNational ?? headline.pctNational), unit: '%', caption: '全国の鉄道' },
    { value: fmtPct(primary?.pctHSR ?? headline.pctHSR), unit: '%', caption: '新幹線・高速鉄道' },
    { value: fmtInt(headline.prefectures), unit: '', caption: '都道府県・地域' },
  ];

  // ── superlatives, resolved to names ──
  const superlatives: WrappedSuperlative[] = [];

  // Longest ride: the max-km longestRide across packages.
  let bestLongest: CoverageResult['longestRide'] | undefined;
  for (const { result } of coverages) {
    const lr = result.longestRide;
    if (lr && (!bestLongest || lr.km > bestLongest.km)) bestLongest = lr;
  }
  if (bestLongest) {
    superlatives.push({
      label: '最長乗車',
      value: `${stationName(geo, bestLongest.fromStationId)} → ${stationName(geo, bestLongest.toStationId)}`,
      sub: `${fmtKm(bestLongest.km)} km`,
    });
  }

  // Most-ridden line: first package (JP-first store order) that names one.
  const mostRiddenLineId = coverages.find((c) => c.result.mostRiddenLineId)?.result
    .mostRiddenLineId;
  if (mostRiddenLineId) {
    superlatives.push({ label: '最も乗った路線', value: lineName(geo, mostRiddenLineId) });
  }

  // Fastest train model: first named one across packages (speed already resolved by the
  // kernel — every package returns the same fastest model from the shared event log).
  // D10 fallback branch: when the 4th-row gate is OFF, this row carries the km/h sub instead
  // (zero layout risk) so the 図鑑 work still enriches the card.
  const fastestTrainModel = coverages.find((c) => c.result.fastestTrainModel)?.result
    .fastestTrainModel;
  if (fastestTrainModel) {
    const speed = !vehicleRow ? topSpeedKmh(fastestTrainModel) : undefined;
    superlatives.push({
      label: '最速の車両',
      value: fastestTrainModel,
      sub: speed !== undefined ? `${speed} km/h` : undefined,
    });
  }

  // D10 primary branch: the 記録した車両 row — count + the 新幹線 meter as the sub. Only when
  // the collection rollup was supplied and has anything to say (zero-safe: no row at 0).
  if (vehicleRow && inputs.collection && inputs.collection.totalModels > 0) {
    const shink = inputs.collection.sections.find((s) => s.category === 'shinkansen')?.meter;
    superlatives.push({
      label: '記録した車両',
      value: `${inputs.collection.totalModels}車両`,
      sub: shink && shink.collected > 0 ? `${shink.label} ${shink.collected}/${shink.total}` : undefined,
    });
  }

  return {
    totalKm: headline.riddenKm,
    stats,
    superlatives,
    generatedLabel: now.toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
  };
}

// ─────────────────────────────── canvas drawing ─────────────────────────────

/** Vertical share-card dimensions (Instagram/X story aspect). */
export const CARD_W = 1080;
export const CARD_H = 1920;

const font = (weight: number, px: number): string => `${weight} ${px}px ${CANVAS_FONT_FAMILY}`;

/**
 * Draw the full Wrapped card into a 1080x1920 2D context. Synchronous + side-effect free
 * beyond the passed ctx — callers MUST have awaited ensureWrappedFonts() first so the
 * webfont weights are decoded (otherwise tofu on a cold cache; see font.ts).
 */
export function drawWrappedCard(ctx: CanvasRenderingContext2D, data: WrappedData): void {
  const W = CARD_W;
  const H = CARD_H;

  // ── ground: mint surface ──
  ctx.fillStyle = tokens.railBg;
  ctx.fillRect(0, 0, W, H);

  // ── folder-tab card frame (DESIGN.md signature) ──
  const M = 72; // outer margin
  const cardX = M;
  const cardY = 150;
  const cardW = W - M * 2;
  const cardH = H - cardY - M;
  const r = 28;

  // the protruding manila tab
  const tabW = 340;
  const tabH = 76;
  const tabX = cardX + 40;
  const tabY = cardY - tabH + 1;
  ctx.fillStyle = tokens.railBg;
  roundRectTop(ctx, tabX, tabY, tabW, tabH, 18);
  ctx.fill();
  ctx.strokeStyle = tokens.railDim;
  ctx.lineWidth = 2;
  roundRectTop(ctx, tabX, tabY, tabW, tabH, 18);
  ctx.stroke();
  // tab label "■ RailPrint"
  ctx.fillStyle = tokens.railLit;
  ctx.fillRect(tabX + 36, tabY + tabH / 2 - 9, 18, 18);
  ctx.fillStyle = tokens.railText;
  ctx.font = font(700, 34);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText('RailPrint', tabX + 70, tabY + tabH / 2 + 2);

  // the card body
  ctx.fillStyle = tokens.white;
  roundRect(ctx, cardX, cardY, cardW, cardH, r);
  ctx.fill();
  ctx.strokeStyle = tokens.railDim;
  ctx.lineWidth = 2;
  roundRect(ctx, cardX, cardY, cardW, cardH, r);
  ctx.stroke();

  const innerX = cardX + 80;
  const innerW = cardW - 160;
  const centerX = cardX + cardW / 2;

  // ── eyebrow + hero km ──
  let y = cardY + 130;
  ctx.textAlign = 'left';
  ctx.fillStyle = tokens.inkMuted;
  ctx.font = font(500, 34);
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('乗った距離', innerX, y);

  y += 200;
  ctx.fillStyle = tokens.railLit;
  ctx.font = font(700, 200);
  ctx.textBaseline = 'alphabetic';
  const kmStr = fmtKm(data.totalKm);
  ctx.fillText(kmStr, innerX, y);
  // "km" unit trailing the big number
  const kmWidth = ctx.measureText(kmStr).width;
  ctx.font = font(700, 72);
  ctx.fillStyle = tokens.railText;
  ctx.fillText('km', innerX + kmWidth + 24, y);

  // ── toy Shinkansen diorama (mirrors Diorama.svelte) ──
  y += 70;
  drawDiorama(ctx, centerX, y, 520);
  y += 300;

  // ── hero stats row (three columns) ──
  const colW = innerW / data.stats.length;
  ctx.textBaseline = 'alphabetic';
  data.stats.forEach((stat, i) => {
    const cx = innerX + colW * i + colW / 2;
    ctx.textAlign = 'center';
    // big number
    ctx.fillStyle = tokens.railLit;
    ctx.font = font(700, 96);
    const numW = ctx.measureText(stat.value).width;
    ctx.fillText(stat.value, cx, y);
    if (stat.unit) {
      ctx.fillStyle = tokens.railText;
      ctx.font = font(700, 44);
      ctx.textAlign = 'left';
      ctx.fillText(stat.unit, cx + numW / 2 + 8, y);
    }
    // caption under it
    ctx.fillStyle = tokens.inkMuted;
    ctx.font = font(500, 28);
    ctx.textAlign = 'center';
    ctx.fillText(stat.caption, cx, y + 50);
  });
  y += 130;

  // divider
  ctx.strokeStyle = tokens.railDim;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(innerX, y);
  ctx.lineTo(innerX + innerW, y);
  ctx.stroke();
  y += 70;

  // ── superlatives ──
  ctx.textAlign = 'left';
  for (const s of data.superlatives) {
    ctx.fillStyle = tokens.inkMuted;
    ctx.font = font(500, 30);
    ctx.fillText(s.label, innerX, y);
    y += 56;
    ctx.fillStyle = tokens.ink;
    ctx.font = font(700, 52);
    ctx.fillText(truncateToWidth(ctx, s.value, innerW), innerX, y);
    if (s.sub) {
      const vW = ctx.measureText(truncateToWidth(ctx, s.value, innerW)).width;
      ctx.fillStyle = tokens.railText;
      ctx.font = font(500, 34);
      // 16px breathing room between value and sub (was 0 — "121 km" hugged the station name;
      // the v0.13 記録した車両 row made the crowding obvious on the smoke render).
      ctx.fillText(s.sub, innerX + Math.min(vW, innerW) + 16, y);
    }
    y += 90;
  }

  // ── footer ──
  ctx.fillStyle = tokens.inkMuted;
  ctx.font = font(400, 26);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`railprint · ${data.generatedLabel}`, innerX, cardY + cardH - 56);
}

/**
 * Render the card to a PNG Blob off-screen. Awaits fonts, draws, toBlob.
 *
 * iOS gesture note: this DOES await fonts, so callers that need navigator.share to keep
 * the user-gesture must build the blob via this fn INSIDE the tap handler and only then
 * call share(blob) (see share.ts) — or, better, warm ensureWrappedFonts() earlier so the
 * await here resolves on the same microtask. We never await long work after share().
 */
export async function renderWrappedToBlob(data: WrappedData): Promise<Blob> {
  await ensureWrappedFonts();
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('renderWrappedToBlob: 2D canvas context unavailable');
  drawWrappedCard(ctx, data);
  return await canvasToBlob(canvas);
}

/**
 * SYNCHRONOUS render → Blob. iOS Safari revokes the user-gesture's transient activation
 * across any task boundary, and canvas.toBlob() fires its callback on a future task — so
 * the async renderWrappedToBlob() cannot be awaited before navigator.share() without
 * losing the gesture (NotAllowedError). This path uses canvas.toDataURL() (synchronous)
 * and decodes it inline, so the caller can build the blob and call share() with ZERO
 * intervening awaits. Fonts must already be warm (ensureWrappedFonts on mount) — this
 * does NOT await document.fonts.ready, by design.
 */
export function renderWrappedBlobSync(data: WrappedData): Blob {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('renderWrappedBlobSync: 2D canvas context unavailable');
  drawWrappedCard(ctx, data);
  const dataUrl = canvas.toDataURL('image/png');
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('canvas.toBlob returned null'));
    }, 'image/png');
  });
}

// ───────────────────────────── canvas primitives ────────────────────────────

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// A tab: rounded top corners only, square bottom (it merges into the card edge).
function roundRectTop(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
}

/**
 * Soft toy Shinkansen on a mint slab — a canvas translation of Diorama.svelte's `train`
 * variant. Centred on (cx) with the slab bottom near (baselineY). `w` is the train width.
 */
function drawDiorama(ctx: CanvasRenderingContext2D, cx: number, baselineY: number, w: number): void {
  const h = w * 0.72; // viewBox 200x150 → 0.75; trimmed slightly
  const s = w / 200; // scale from the SVG's 200-wide viewBox
  const x0 = cx - w / 2;
  const y0 = baselineY - h;
  const X = (n: number): number => x0 + n * s;
  const Y = (n: number): number => y0 + n * s;
  const R = (n: number): number => n * s;

  // soft ground shadow
  ctx.fillStyle = 'rgba(26,26,26,0.06)';
  ctx.beginPath();
  ctx.ellipse(X(100), Y(132), R(78), R(9), 0, 0, Math.PI * 2);
  ctx.fill();

  // mint slab
  ctx.fillStyle = tokens.railBg;
  roundRect(ctx, X(14), Y(116), R(172), R(22), R(11));
  ctx.fill();

  // train body (rounded long nose to the right) — emerald
  ctx.fillStyle = tokens.railLit;
  ctx.beginPath();
  ctx.moveTo(X(28), Y(70));
  ctx.lineTo(X(150), Y(70));
  ctx.quadraticCurveTo(X(190), Y(70), X(190), Y(96));
  ctx.lineTo(X(190), Y(102));
  ctx.quadraticCurveTo(X(190), Y(108), X(184), Y(108));
  ctx.lineTo(X(28), Y(108));
  ctx.quadraticCurveTo(X(22), Y(108), X(22), Y(102));
  ctx.lineTo(X(22), Y(76));
  ctx.quadraticCurveTo(X(22), Y(70), X(28), Y(70));
  ctx.closePath();
  ctx.fill();

  // darker nose accent
  ctx.fillStyle = tokens.railText;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.moveTo(X(150), Y(70));
  ctx.quadraticCurveTo(X(190), Y(70), X(190), Y(96));
  ctx.lineTo(X(150), Y(96));
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  // belly stripe
  ctx.fillStyle = tokens.railText;
  roundRect(ctx, X(28), Y(92), R(156), R(7), R(3.5));
  ctx.fill();

  // windows
  ctx.fillStyle = tokens.white;
  for (const wx of [40, 62, 84, 106, 128]) {
    roundRect(ctx, X(wx), Y(78), R(15), R(10), R(3));
    ctx.fill();
  }

  // wheels
  for (const wcx of [58, 120]) {
    ctx.fillStyle = tokens.ink;
    ctx.beginPath();
    ctx.arc(X(wcx), Y(116), R(9), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = tokens.railBg;
    ctx.beginPath();
    ctx.arc(X(wcx), Y(116), R(3.4), 0, Math.PI * 2);
    ctx.fill();
  }
}

// Trim a string to fit `maxW` px at the current ctx font, appending an ellipsis.
function truncateToWidth(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + '…';
}
