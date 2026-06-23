// T8 / D7 — font loading for the Wrapped <canvas>.
//
// Canvas text does NOT participate in the CSS font-loading lifecycle: if you draw before
// the webfont is actually decoded, the browser silently falls back to a system face
// (tofu / wrong metrics) and you only find out from the exported PNG. The fix is to
// explicitly `document.fonts.load(...)` the EXACT weights+sizes the card draws, then
// `await document.fonts.ready`, BEFORE the first fillText.
//
// v0 uses the Noto Sans JP CDN already linked from index.html. D7 self-hosts a subset
// later; this module is the single seam where the family/weights are declared, so the
// subset swap is a one-line change here and nothing in card.ts moves.

/** The canvas font family. Mirrors tokens.font.family's primary face. */
export const CANVAS_FONT_FAMILY = "'Noto Sans JP'";

// The card draws body (400), labels (500) and big display numbers (700). We load each
// weight at a representative px size — `document.fonts.load` keys on the full font
// shorthand, so we request a size in the range the card actually paints to guarantee the
// glyphs (Latin + digits + the Japanese station/line names) are decoded before drawing.
const FACES_TO_LOAD: readonly string[] = [
  `400 64px ${CANVAS_FONT_FAMILY}`,
  `500 64px ${CANVAS_FONT_FAMILY}`,
  `700 220px ${CANVAS_FONT_FAMILY}`,
];

let readyPromise: Promise<void> | null = null;

/**
 * Ensure every weight the Wrapped card draws is decoded and ready.
 *
 * Idempotent + memoised: safe to call eagerly (e.g. on the Stats screen mount) so the
 * font is warm by the time the user taps "Wrapped を作成". MUST be awaited before any
 * canvas fillText, or the export shows tofu on a cold cache.
 *
 * Resolves (never rejects) even if the Font Loading API is unavailable — the caller still
 * draws; worst case the system fallback is used. Drawing is never blocked by a font error.
 */
export function ensureWrappedFonts(): Promise<void> {
  if (readyPromise) return readyPromise;
  readyPromise = loadFonts();
  return readyPromise;
}

async function loadFonts(): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  try {
    // Kick off decode of each weight (passing a sample of the glyph classes the card
    // paints so subset fonts fetch the right unicode-range).
    await Promise.all(FACES_TO_LOAD.map((face) => document.fonts.load(face, '東京 0123 km')));
  } catch {
    // A single face failing to load must not block the render — fall through to ready.
  }
  try {
    await document.fonts.ready;
  } catch {
    /* no-op: best-effort */
  }
}
