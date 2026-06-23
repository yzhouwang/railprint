# RailPrint — Design System

Source: extracted from JR East recruit site ([recruit.jreast.co.jp](https://recruit.jreast.co.jp/)) during /plan-design-review (2026-06-23). Approved mockups in `~/.gstack/projects/train/designs/railprint-20260623/`.

**Aesthetic in one line:** emerald-on-white monochrome discipline + folder-tab cards + soft 3D claymation dioramas. Calm App-UI surface; the only color that matters is the green your ridden lines glow in. The deliberate opposite of the rainbow-clutter, web-1.0 incumbent (乗りつぶしオンライン).

Classifier: **App UI** (workspace/tool, not a marketing page). Calm surface hierarchy, few colors, cards earn their existence.

## Color

| Token | Hex | Use |
|---|---|---|
| `emerald-600` | `#00A040` | The accent. Glowing ridden lines, large display numbers (≥24px), progress fills, FAB/accent. NOT for small text on white. |
| `emerald-800` | `#006B2D` | Filled buttons/FAB with white text (≈5:1 contrast), small emerald text/icons on white (passes AA). |
| `mint-50` | `#EAF4EE` | Surface fills, progress-bar tracks, diorama slabs. |
| `grey-line` | `#D7DEDA` | Unridden network lines + unridden station dots. |
| `ink` | `#1A1A1A` | Primary text. |
| `ink-muted` | `#6B756F` | Secondary text, labels. |
| `white` | `#FFFFFF` | Ground. |

Monochrome rule: one accent (emerald). No second hue. Ridden = emerald, everything else = grey/ink/mint.

## Typography

- **Noto Sans JP** (open, free, subsettable — matches eng-review T8 font-subsetting). Primary for JP + Latin + digits. NO system-ui / default stacks.
- Weights: 400 body, 500 labels/headings, 700 display numbers.
- Display numbers (km, %) are the loudest type on screen. Scale: 30px % hero, 26px km, 16px stat values, 13px body, 11px labels. Never below 11px.

## Spacing & shape

- Spacing scale: 4 / 8 / 12 / 16 / 24 / 32.
- Radius: cards 14px, FAB/pills 999px, buttons 10px. Touch targets ≥44px.

## Signature components

- **Folder-tab card** (the unconventional move): a card with a small label chip protruding from the top-left corner, like a manila-folder tab. Used for the completion-stat card, the Wrapped card frame, and section panels. The tab carries a `■ label`.
- **Glowing line treatment:** ridden = `emerald-600` stroke 4px (luminous); unridden = `grey-line` stroke 2px. Station dots: emerald (ridden) / grey (unridden). **Colorblind-safe:** ridden lines are differentiated by *thickness*, not color alone — deuteranopia still reads the network.
- **Completion stat card:** folder-tab card, hero `38%` in emerald-600, `12,480 km · JR全線` muted sub, thin emerald progress bar on a mint track.
- **Bottom tab bar:** `地図 · 統計 · 取込` (map / stats-Wrapped / import), always visible; the green `+` FAB for "mark a ride" floats above it. (Design Issue 1.)
- **3D claymation dioramas:** soft low-poly toy vignettes (a Shinkansen on a platform, a departure board, an empty station). Used for the Wrapped hero, train-model collectibles, and the empty state. Warm, precise, toy-like — never stock-photo.
- **Pills & FAB:** emerald-800 fill + white text for primary; emerald-800 outline for secondary.

## Interaction states (Design Issue 2 + Pass 2)

| Feature | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| Map | skeleton grey network fades in | (network always shown) | "地図の読み込みに失敗" + retry | ridden lines glow in | — |
| Online-only (v0) | — | — | offline overlay: "地図は接続が必要です。記録は閲覧できます" (cached stats still readable) | — | — |
| Import | progress "取り込み中… 740/1,240" | — | parse error → row report, nothing saved | "1,240件を取り込みました" + map floods green | **Review & resolve: "1,180/1,240 mapped · 60 need help"** → list of unmatched rows with suggested match → confirm/skip |
| Mark a ride | — | — | "この区間は記録済み" guard | segment lights + km/% ticks up | — |
| Empty state | — | warm diorama + import (primary) + map-mark (secondary) | — | — | — |

## Motion (App-UI restraint: 2-3 intentional motions)

1. **The signature beat — "the map floods green":** when import completes, ridden segments light up sequentially across the network (a wave), and the `%` counter ticks up to its value. This is the emotional payoff; design it, don't let it be a static repaint.
2. Mark-a-ride: the single segment lights with a brief pulse; the stat card's number ticks.
3. Tab/FAB: standard press feedback (scale 0.98). No decorative motion.

## Responsive

- **Mobile (≤480px):** full-bleed map, bottom tab bar, stat card floats bottom. The primary target.
- **Tablet/desktop (≥768px):** full-bleed map with a **persistent side panel** (left or right) holding the line picker + stats + completion — NOT a stretched mobile layout. The Wrapped card renders at a fixed share size regardless of viewport.

## Accessibility

- **Contrast:** emerald-600 (`#00A040`) is for fills, glowing lines, and ≥24px display numbers ONLY — it fails 4.5:1 for small text. Small emerald text/icons use emerald-800 (`#006B2D`). White-on-emerald buttons use emerald-800 fill.
- **Colorblind:** ridden/unridden distinguished by line thickness + dot fill, not hue alone.
- Keyboard nav for line picker + marking; visible focus rings; ARIA landmarks (map region, tab bar as nav); 44px touch targets.

## Deferred (NOT in v0 scope)

- **Dark mode** — v1. (The emerald/mint system has dark equivalents; not now.)
- Custom diorama art for every train model — start with a small set, expand with the collection feature.
- Map basemap styling polish (the muted basemap treatment) — iterate after the core loop.
