# Experience lane (Claude) — multicolor map + hover→lines popup + logos in UI

**Owner:** experience. **Touches:** `src/lib/map/style.ts`, `src/screens/MapView.svelte`, `src/lib/store.ts`.
**Does NOT touch:** `pipeline/`, `data/`, `public/rail/*`, `src/contract/types.ts`.
**Consumes:** the engine lane's package with `RailLine.color`/`logo` + `public/rail/logos/` + `logo-credits.json`.
C1–C4 (recolor) need only `color`; the popup/logo bits need the engine's logos (use stub colors/logos for tests).

## Decisions (locked)
- **Hue = official line color (identity); ridden-state = OPACITY** (unridden ~0.35, ridden 1.0). Brand
  emerald stays for chrome/stats/Wrapped — this is MAP-ONLY; do NOT touch tokens.ts / wrapped / stats.

## Tasks

### C1 — static per-segment color (NOT a 594-line match rewritten per frame)
`buildSegmentCollection` (style.ts) already emits per-segment props — add `color` (from the segment's
`RailLine.color` via the geo index). `lineColorExpression` → `['get','color']`, set ONCE on layer add.

### C2 — ridden = official color + THICK + glow; unridden = faded + thin (DESIGN-REVIEW LOCKED)
Ridden state rides THREE channels, not opacity alone (DESIGN.md makes ridden colorblind-safe via THICKNESS —
opacity-only is not). Unridden = the line's color at ~0.35 opacity + DESATURATED + 2px thin. Ridden = FULL
official color + 4px + a soft glow in the LINE'S OWN color (drop the hard-coded `tokens.railLit` glow).
`repaint()` updates opacity + width (the lit-keyed channels) — never the base color, which is static per C1.
Flood-on-import sweeps in each line's own color (keeps the signature motion, now multicolor), pulse unchanged.

### C3 — selection = DARK casing UNDERLAY (NOT white — invisible on the near-white basemap)
Replace the red top-highlight: add a casing layer BELOW the base line, wider than it, filtered to
`selectedLineSegmentIds` via `setFilter`. Color it `tokens.ink` (dark) or a darkened line-color halo — a WHITE
casing disappears on the light OSM basemap. The line's hue shows on top; the dark casing reads as "selected".
Keep the no-setFeatureState rule.

### C4 — neutral station dots
Dots stop encoding ridden via emerald/grey hue (now reserved for lines). Make dots a neutral state channel
(e.g. dark = ridden, light grey = unridden, by lightness not hue). Transfer-station colors live in the popup,
not the dot.

### C5 — hover → lines popup (the headline ask)
Emit `stationGroupId` in the station feature props (style.ts station builder currently omits it). On hover,
look up `geo.stationGroupById[groupId]` → render one row PER line through that station:
`[logo <img> | color swatch] 線名 (Romaji)`. Reuse the C5 popup; missing logo → show the color swatch.

### C6 — logos wherever a line is named
Line-picker chips (replace the hard-coded green dot at MapView ~:561/:775), station-first search result rows
(~:606), and the selection panel (~:573): show `[logo|swatch] name`. **Logos normalize to a fixed HEIGHT
(~16px), width auto, left-aligned** (Commons logos vary wildly — square metro circles vs wide JR wordmarks);
missing-logo fallback = the color swatch. **Cap the popup list / scroll past ~6 lines** (新宿 has 7) so a
transfer hub doesn't overflow the viewport.

### C7 — logo attribution
Surface `logo-credits.json` in the about/credits (Commons P154 needs per-file attribution). Keep the existing
N02 + OSM credits.

### C8 — tests
Unit: `['get','color']` paint built; opacity-by-lit expression; popup lists a group's N lines with swatch+logo;
neutral-dot expression. E2E: hover 新宿 → popup shows its 7 lines each with a color; a colored line renders.

## Design verification (post-build)
The generic mockup tool can't represent our specific national rail render, so verify the REAL multicolor map
in a headed GPU browser (as in /qa): legibility at national zoom (594 hues + faded unridden shouldn't mush),
ridden saturate+thicken reads as completion, dark casing is visible, popup logos align. Then `/plan-design-review` re-pass.

## Done
Map renders lines in official colors with ridden = saturate+4px+glow / unridden = faded+thin, selection = dark casing, neutral dots; hover lists a
station's lines with logo+color+bilingual name; logos in picker/search/panel; `npm test` + svelte-check green;
browser-verified.
