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
