// Bridges the TS design tokens to CSS custom properties so Svelte components can use
// `var(--rail-lit)` etc. while tokens.ts stays the single source of truth (the map +
// canvas read the same tokens object directly). Call applyTheme() once before mount.

import { tokens, space, radius, font } from './tokens';

export const cssVariables: Record<string, string> = {
  '--rail-lit': tokens.railLit,
  '--rail-text': tokens.railText,
  '--rail-dim': tokens.railDim,
  '--rail-bg': tokens.railBg,
  '--ink': tokens.ink,
  '--ink-muted': tokens.inkMuted,
  '--white': tokens.white,

  '--space-xs': `${space.xs}px`,
  '--space-sm': `${space.sm}px`,
  '--space-md': `${space.md}px`,
  '--space-lg': `${space.lg}px`,
  '--space-xl': `${space.xl}px`,
  '--space-xxl': `${space.xxl}px`,

  '--radius-card': `${radius.card}px`,
  '--radius-button': `${radius.button}px`,
  '--radius-pill': `${radius.pill}px`,

  '--font-family': font.family,
  '--weight-body': `${font.weight.body}`,
  '--weight-label': `${font.weight.label}`,
  '--weight-display': `${font.weight.display}`,

  '--size-pct-hero': `${font.size.pctHero}px`,
  '--size-km': `${font.size.km}px`,
  '--size-stat': `${font.size.statValue}px`,
  '--size-body': `${font.size.body}px`,
  '--size-label': `${font.size.label}px`,
};

export function applyTheme(root: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(cssVariables)) {
    root.style.setProperty(name, value);
  }
}
