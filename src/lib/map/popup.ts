// C5 — the hover→lines popup model + HTML (PURE; no maplibre/DOM beyond a string of escaped
// HTML the MapView feeds to a MapLibre Popup). Given a hovered station, list EVERY line through
// its physical cross-line group, each as `[logo <img> | color swatch] 線名 (Romaji)`. Missing
// logo → the color swatch. Extracted from MapView so it is unit-testable (no Svelte mount).

import type { GeoIndex } from '../store';
import { groupKeyOf } from '../store';
import { bilingualLabel } from '../search';
import { DEFAULT_LINE_COLOR } from './style';

/** One line through a station, with the data the popup row needs. */
export interface PopupLineRow {
  lineId: string;
  /** Bilingual display label, e.g. `山手線 (Yamanote Line)`. */
  label: string;
  /** The line's official color (always a hex — falls back to DEFAULT_LINE_COLOR). */
  color: string;
  /** Logo path when the line has one, else undefined → the row shows the color swatch. */
  logo?: string;
}

/** The full popup model for a hovered station: bilingual header + one row per line. */
export interface PopupModel {
  name: string;
  nameRoma?: string;
  lines: PopupLineRow[];
}

/**
 * Build the popup model for a physical station. Looks up the station's cross-line GROUP (so a
 * transfer hub like 新宿 lists all 7 of its lines), dedupes lines, and sorts by name for a
 * stable order. `lineIdFallback` (the hovered feature's own line) backstops a missing group.
 */
export function buildPopupModel(
  geo: GeoIndex,
  stationId: string,
  lineIdFallback?: string,
): PopupModel | null {
  const st = geo.stationById.get(stationId);
  const groupKey = st ? groupKeyOf(st) : `solo:${stationId}`;
  const members = geo.stationGroupById.get(groupKey) ?? [];

  const rows: PopupLineRow[] = [];
  const seen = new Set<string>();
  const add = (lineId: string): void => {
    if (seen.has(lineId)) return;
    const line = geo.lineById.get(lineId);
    if (!line) return;
    seen.add(lineId);
    rows.push({
      lineId: line.lineId,
      label: bilingualLabel(line.name, line.nameRoma),
      color: line.color ?? DEFAULT_LINE_COLOR,
      ...(line.logo ? { logo: line.logo } : {}),
    });
  };
  for (const m of members) add(m.lineId);
  if (rows.length === 0 && lineIdFallback) add(lineIdFallback);
  rows.sort((a, b) => a.label.localeCompare(b.label));

  return {
    name: st?.name ?? stationId,
    ...(st?.nameRoma ? { nameRoma: st.nameRoma } : {}),
    lines: rows,
  };
}

/** Escape a string for safe interpolation into the popup's innerHTML. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

/** One line's leading badge: its logo <img> (normalized in CSS to ~16px height) or a swatch. */
export function lineBadgeHtml(row: PopupLineRow): string {
  if (row.logo) return `<img class="rp-line-logo" src="${escapeHtml(row.logo)}" alt="" loading="lazy" />`;
  return `<span class="rp-line-swatch" style="background:${escapeHtml(row.color)}"></span>`;
}

/** The popup's full escaped HTML: bilingual header + one `[badge] label` row per line. */
export function popupHtml(model: PopupModel): string {
  const header = model.nameRoma
    ? `<span class="rp-popup-ja">${escapeHtml(model.name)}</span><span class="rp-popup-roma">${escapeHtml(model.nameRoma)}</span>`
    : `<span class="rp-popup-ja">${escapeHtml(model.name)}</span>`;
  const rows = model.lines
    .map((r) => `<li class="rp-line-row">${lineBadgeHtml(r)}<span class="rp-line-name">${escapeHtml(r.label)}</span></li>`)
    .join('');
  return (
    `<div class="rp-popup"><div class="rp-popup-head">${header}</div>` +
    (rows ? `<ul class="rp-line-list">${rows}</ul>` : '') +
    `</div>`
  );
}
