// RailPrint design tokens — single source of the emerald monochrome system.
// Owned by the Claude lane (D3); seeded by steering-control. Codex T6-adjacent
// build steps and Claude T8 canvas + T6 map style ALL read from here — never fork.
// Full system: /DESIGN.md.

export const tokens = {
  // Emerald accent — the ONLY hue.
  railLit: '#00A040',   // emerald-600: glowing ridden lines, progress fills, display numbers ≥24px. NOT for <16px text.
  railText: '#006B2D',  // emerald-800: small emerald text/icons + filled buttons w/ white text (AA on white).
  railDim: '#D7DEDA',   // unridden network lines + unridden station dots.
  railBg: '#EAF4EE',    // mint surface fills, progress tracks, diorama slabs.

  ink: '#1A1A1A',       // primary text
  inkMuted: '#6B756F',  // secondary text / labels
  white: '#FFFFFF',
} as const;

export type TokenName = keyof typeof tokens;

// Map style consumes railLit/railDim keyed on RailGeoPackage feature props
// `segmentId` + `isHSR`. Ridden = railLit 4px; unridden = railDim 2px.
// Colorblind-safe: ridden differentiated by THICKNESS, not hue alone.

// ───────────────────────── scale tokens (D3, DESIGN.md) ─────────────────────
// Extends the color system above with the spacing / shape / type scale. The map +
// canvas read the COLORS from `tokens`; CSS components read these via theme.ts vars.

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { card: 14, button: 10, pill: 999 } as const;

export const font = {
  // Noto Sans JP — open, subsettable; covers JP + Latin + digits. NO system-ui stack.
  family: "'Noto Sans JP', system-ui, sans-serif",
  weight: { body: 400, label: 500, display: 700 },
  // Display numbers are the loudest type on screen; never below 11px (DESIGN.md).
  size: { pctHero: 30, km: 26, statValue: 16, body: 13, label: 11 },
} as const;

// Line treatment (DESIGN.md glowing-line spec) — shared by the map style + card.
export const stroke = { ridden: 4, unridden: 2 } as const;
