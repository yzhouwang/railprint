// D21 STAGE 2 — per-model silhouette specs (v0.13.3 silhouette pipeline). PURE DATA.
//
// Each spec is authored against a gpt-image-2 reference render (docs/refs/<fold>.png,
// gitignored, reference-only — see the TODOS pipeline entry) in the claymation language
// of TrainSilhouette.svelte: viewBox 100×52, nose to the RIGHT, rounded toy proportions.
//
// DD10 contract carried over exactly: the BODY path never hardcodes fill — it inherits
// the component's single cascade fill (ghost token when uncollected, registry accentColor
// when collected). Livery `bands` are the DD8 carve-out: real livery colors, drawn ONLY
// on collected cards (ghosts stay monochrome), clipped INSIDE the body path so accents
// can never leak into the chrome.
//
// Authoring grid: roof ≈ y26–28 · window row y≈31 · floor y≈45 · body from x=6; the
// nose taper starts at `S` and reaches its tip near x=88–94 depending on nose family
// (needle 500 > duck E5/H5 > arrow E6/E8 > aero N700s > wedge E7/W7 > round E2/800).

export interface SilhouetteBand {
  y: number;
  h: number;
  color: string;
}

export interface SilhouetteSpec {
  /** Closed body outline incl. the nose. Inherits the DD10 cascade fill — never self-fills. */
  body: string;
  /** Cab-window glass near the nose (drawn white, like the category variants). */
  cab: string;
  /** Passenger window row (small rounded rects, white). */
  windows: { x: number; count: number; pitch: number; y: number; w: number; h: number };
  /** Livery bands (DD8): clipped to the body, rendered on COLLECTED cards only. */
  bands?: SilhouetteBand[];
  /** Wheel x-positions (decorative, neutral fill). */
  wheels: [number, number];
}

const WHITE = '#F4F6F4';
const IVORY = '#F2F0E6';

export const SILHOUETTE_SPECS: Readonly<Record<string, SilhouetteSpec>> = {
  // ── E5/H5 — the long double-cusp duck nose; green body, white belly, signature stripe ──
  E5: {
    body: 'M6 30 q0 -3 3 -3 H40 q22 0 34 5.5 q14 5.5 19 9.8 q2.6 2.7 -1.8 2.7 H9 q-3 0 -3 -3 Z',
    cab: 'M62 29.2 q7.5 0.8 12.5 3.6 q-2.2 1.8 -5.4 1.2 q-4.4 -0.8 -7.1 -3 Z',
    windows: { x: 11, count: 3, pitch: 12.5, y: 31.4, w: 8, h: 4.6 },
    bands: [
      { y: 36.2, h: 7.4, color: WHITE },
      { y: 34.8, h: 1.7, color: '#E5006E' }, // はやてピンク
    ],
    wheels: [20, 54],
  },
  H5: {
    body: 'M6 30 q0 -3 3 -3 H40 q22 0 34 5.5 q14 5.5 19 9.8 q2.6 2.7 -1.8 2.7 H9 q-3 0 -3 -3 Z',
    cab: 'M62 29.2 q7.5 0.8 12.5 3.6 q-2.2 1.8 -5.4 1.2 q-4.4 -0.8 -7.1 -3 Z',
    windows: { x: 11, count: 3, pitch: 12.5, y: 31.4, w: 8, h: 4.6 },
    bands: [
      { y: 36.2, h: 7.4, color: WHITE },
      { y: 34.8, h: 1.7, color: '#9B7CC8' }, // 彩香パープル
    ],
    wheels: [20, 54],
  },

  // ── E6 — arrow nose; crimson over white with a silver line ──
  E6: {
    body: 'M6 30.5 q0 -3 3 -3 H42 q24 0 36 5.8 q13 5 16.5 9.3 q2 2.4 -2 2.4 H9 q-3 0 -3 -3 Z',
    cab: 'M60 29.6 q7 0.7 12 3.4 q-2 1.7 -5 1.2 q-4.2 -0.8 -7 -3 Z',
    windows: { x: 11, count: 3, pitch: 12.5, y: 31.8, w: 8, h: 4.4 },
    bands: [
      { y: 36.6, h: 7, color: WHITE },
      { y: 35.4, h: 1.4, color: '#C9CED4' }, // silver arrow line
    ],
    wheels: [20, 54],
  },

  // ── E8 — slender long nose; white with purple sweep + 紅花 yellow stripe ──
  E8: {
    body: 'M6 30 q0 -3 3 -3 H44 q22 0 33 6 q12 5.2 15.5 9 q2.2 2.5 -2 2.5 H9 q-3 0 -3 -3 Z',
    cab: 'M62 29.4 q7 0.8 11.8 3.5 q-2.1 1.7 -5.2 1.2 q-4.3 -0.8 -7 -3 Z',
    windows: { x: 11, count: 3, pitch: 12.5, y: 31.5, w: 8, h: 4.5 },
    bands: [
      { y: 36.2, h: 7.4, color: WHITE },
      { y: 34.9, h: 1.6, color: '#E8C51C' }, // 紅花イエロー
    ],
    wheels: [21, 55],
  },

  // ── 500 — the needle; grey-blue fuselage, dark window band, light-blue line ──
  '500': {
    body: 'M6 32 q0 -6.5 6.5 -6.5 H30 q30 0 47 7.5 q13 5.4 12.5 9.6 q-0.2 2.4 -3.4 2.4 H10 q-4 0 -4 -4 Z',
    cab: 'M58 27.6 q8 0.9 13.5 3.4 q-2.4 1.9 -5.8 1.3 q-4.8 -0.8 -7.7 -2.9 Z',
    windows: { x: 11, count: 4, pitch: 10.5, y: 30.6, w: 6, h: 4 },
    bands: [
      { y: 29.8, h: 5.6, color: '#33415C' }, // dark window band
      { y: 36.2, h: 1.2, color: '#7EA8D8' }, // thin light-blue line
    ],
    wheels: [19, 50],
  },

  // ── 700 — duckbill: taper into a blunt rounded bill ──
  '700': {
    body: 'M6 29.5 q0 -3 3 -3 H48 q20 0 28 6.5 q7 2.6 10 6 q1.8 2 0.6 3.4 q-0.8 1.1 -3.6 1.1 H9 q-3 0 -3 -3 Z',
    cab: 'M60 28.8 q7 0.8 11.5 3.2 q-2 1.7 -5.2 1.2 q-4 -0.7 -6.6 -2.7 Z',
    windows: { x: 11, count: 4, pitch: 12, y: 31, w: 7.5, h: 4.6 },
    bands: [{ y: 35.8, h: 7.8, color: WHITE }],
    wheels: [22, 56],
  },

  // ── N700 family — aero double-wing nose; blue identity, white belly (gold line on さくら) ──
  N700S: {
    body: 'M6 29.5 q0 -3 3 -3 H46 q22 0 32 5 q13 5.2 17.5 10 q2.2 2.5 -2.2 2.5 H9 q-3 0 -3 -3 Z',
    cab: 'M60 29.2 q7.5 0.8 12.5 3.6 q-2.2 1.8 -5.4 1.2 q-4.4 -0.8 -7.1 -3 Z',
    windows: { x: 11, count: 4, pitch: 12, y: 31, w: 7.5, h: 4.6 },
    bands: [{ y: 35.8, h: 7.8, color: WHITE }],
    wheels: [22, 56],
  },
  N700A: {
    body: 'M6 29.5 q0 -3 3 -3 H46 q22 0 32 5 q13 5.2 17.5 10 q2.2 2.5 -2.2 2.5 H9 q-3 0 -3 -3 Z',
    cab: 'M60 29.2 q7.5 0.8 12.5 3.6 q-2.2 1.8 -5.4 1.2 q-4.4 -0.8 -7.1 -3 Z',
    windows: { x: 11, count: 4, pitch: 12, y: 31, w: 7.5, h: 4.6 },
    bands: [{ y: 35.8, h: 7.8, color: WHITE }],
    wheels: [22, 56],
  },
  N700: {
    body: 'M6 29.5 q0 -3 3 -3 H46 q22 0 32 5 q13 5.2 17.5 10 q2.2 2.5 -2.2 2.5 H9 q-3 0 -3 -3 Z',
    cab: 'M60 29.2 q7.5 0.8 12.5 3.6 q-2.2 1.8 -5.4 1.2 q-4.4 -0.8 -7.1 -3 Z',
    windows: { x: 11, count: 4, pitch: 12, y: 31, w: 7.5, h: 4.6 },
    bands: [
      { y: 35.8, h: 7.8, color: WHITE },
      { y: 35, h: 1, color: '#C7A75C' }, // さくら gold line
    ],
    wheels: [22, 56],
  },

  // ── E7/W7 — one-motion wedge; ivory belly + copper stripe ──
  E7: {
    body: 'M6 29 q0 -3.5 3.5 -3.5 H58 q17 0.5 24 10.5 l3 5 q1.8 3.5 -2.8 3.5 H9.5 q-3.5 0 -3.5 -3.5 Z',
    cab: 'M72 29.5 q7.5 1.3 11 6.8 h-7.4 q-2.3 0 -3.1 -2.3 Z',
    windows: { x: 11, count: 4, pitch: 12.5, y: 30.8, w: 8, h: 4.8 },
    bands: [
      { y: 35.8, h: 7.8, color: IVORY },
      { y: 34.5, h: 1.5, color: '#B4753C' }, // 銅色
    ],
    wheels: [23, 58],
  },
  W7: {
    body: 'M6 29 q0 -3.5 3.5 -3.5 H58 q17 0.5 24 10.5 l3 5 q1.8 3.5 -2.8 3.5 H9.5 q-3.5 0 -3.5 -3.5 Z',
    cab: 'M72 29.5 q7.5 1.3 11 6.8 h-7.4 q-2.3 0 -3.1 -2.3 Z',
    windows: { x: 11, count: 4, pitch: 12.5, y: 30.8, w: 8, h: 4.8 },
    bands: [
      { y: 35.8, h: 7.8, color: IVORY },
      { y: 34.5, h: 1.5, color: '#B4753C' },
    ],
    wheels: [23, 58],
  },

  // ── E2 — rounded wedge; ivory upper, blue body, つつじピンク stripe ──
  E2: {
    body: 'M6 28.5 q0 -3.5 3.5 -3.5 H62 q14 0.5 20 9.5 l4 6.5 q2 3.5 -2.8 3.5 H9.5 q-3.5 0 -3.5 -3.5 Z',
    cab: 'M74 29 q7 1.2 10.2 6.6 h-7 q-2.2 0 -3 -2.2 Z',
    windows: { x: 11, count: 4, pitch: 12.5, y: 30.5, w: 8, h: 4.8 },
    bands: [
      { y: 25, h: 8.6, color: IVORY }, // ivory upper body
      { y: 33.6, h: 1.7, color: '#D64F93' }, // つつじピンク
    ],
    wheels: [24, 60],
  },

  // ── 800 — rounded blunt wedge; white with red lines ──
  '800': {
    body: 'M6 29 q0 -3.5 3.5 -3.5 H60 q15 0.5 21 9.5 l3.4 6 q1.9 3.5 -2.8 3.5 H9.5 q-3.5 0 -3.5 -3.5 Z',
    cab: 'M72 29.5 q7 1.3 10.4 6.6 h-7.2 q-2.2 0 -3 -2.2 Z',
    windows: { x: 11, count: 4, pitch: 12.5, y: 30.8, w: 8, h: 4.8 },
    bands: [
      { y: 35.8, h: 7.8, color: WHITE },
      { y: 34.7, h: 1.3, color: '#D7261D' }, // つばめ red line
    ],
    wheels: [23, 58],
  },
};

/** Spec for a registry CARD fold, or undefined (category-variant fallback). */
export function silhouetteSpec(fold: string): SilhouetteSpec | undefined {
  return SILHOUETTE_SPECS[fold];
}
