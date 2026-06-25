# Codex engine task — S1 line-logo index repair + operator-aware pick + gate

**You own:** `pipeline/line-style.ts`, `pipeline/verify-jp.ts`. **Do NOT touch** `src/` or `src/contract/types.ts`.
**No network.** Work offline against the committed caches. Trailer: `Co-Authored-By: GPT-5.5 (Codex) <noreply@openai.com>`.

## Context (verified)
`pipeline/line-style.ts` joins N02 lines to `data/readings/wikidata-line-style.json` rows `{op, ja, color, logo(=src URL)}`,
then resolves a downloaded PNG via `data/readings/logo-index.json` (`name -> {file, src}`). Today 227/594 lines ship a
logo; ~320 PNGs are on disk; ~93 are stranded by two bugs:

- **BUG 1 (line ~221) `firstUniqueSourceStyle`:** keeps `logoSrc` only if every matched row agrees
  (`unique(...).length === 1`). Lines matching ≥2 rows with different symbols → `undefined` → no logo.
- **BUG 2 (lines ~256-261) gate:** looks up `logoIndex[match.name]` (keyed by Japanese NAME) AND requires
  `logo.src === match.logoSrc`. The downloaded PNGs are addressable by their `src` URL; name-keying + exact-src
  strands PNGs that are physically present.

## Fix 1 — resolve the PNG by `src`, not name
Build a `Map<srcUrl, LogoIndexEntry>` from `logoIndex` once (`Object.values`). After choosing a primary `logoSrc`
(Fix 2), look the PNG up in that src-map. Keep the on-disk file (`logo.file`) existence behavior. Drop the
`logo.src === match.logoSrc` equality branch (the src-map IS the match). NEVER attach a PNG whose src didn't come
from this line's matched rows.

## Fix 2 — operator-aware primary pick (CRITICAL — wrong badge is worse than none)
In `firstUniqueSourceStyle`, when there are ≥2 distinct candidate `logoSrc`, do NOT pick arbitrarily. Pick the
candidate whose **symbol file belongs to the line's own operator family**. Pass the line's operator into the
function. Operator → expected symbol-filename tokens (case-insensitive substring on the decoded Commons filename):

| N02 operator | Family tokens (filename contains any) |
|---|---|
| 東日本旅客鉄道 (JR East) | `JR J` (e.g. `JR JY line symbol`), `Shinkansen jre` |
| 西日本旅客鉄道 (JR West) | `JRW ` (e.g. `JRW kinki-A`), `Shinkansen jrw` |
| 東海旅客鉄道 (JR Central) | `Shinkansen jrc`, `JR Central` |
| 九州旅客鉄道 (JR Kyushu) | `JRK`, `Shinkansen jrk` |
| 北海道旅客鉄道 (JR Hokkaido) | `JRH`, `Shinkansen jrh` |
| 四国旅客鉄道 (JR Shikoku) | `JRS`, `Shikoku` |

Rules:
1. If the operator is a **JR company**: choose the first candidate (lexicographic order for determinism) whose
   filename matches that company's tokens. If NONE match → attach **no logo** (fail-closed). This is the
   `北陸新幹線` case: a JR-East 北陸新幹線 must NOT receive `Shinkansen jrw.svg`; a JR-West one must NOT receive jre.
2. If the operator is **non-JR** (private/metro): all candidates almost always share the one operator, so pick the
   lexicographically-first candidate that exists in the src-map. (Multiple line-codes for one physical private line,
   e.g. 名鉄尾西 `NP-BS`/`NP-TB`, are both correct-operator — either is fine; just be deterministic.)
3. Color: keep current behavior but make it deterministic too (prefer any sourced hex; lexicographic tiebreak).
4. No `Date.now()` / `Math.random()` — builds must be byte-reproducible.

## Fix 3 — gate in `pipeline/verify-jp.ts`
Add, as hard checks in the existing gate (keep all current station/color checks):
1. **Exact-logo goldens** (derive the expected filename by reading the actual cache, do not hardcode blind):
   pick ≥1 JR-East J-code line, ≥1 JR-West Kinki line, and BOTH `北陸新幹線` operator variants; assert the JR-East
   one's attached logo filename contains a JR-East token and the JR-West one a JRW token (and NOT vice-versa).
2. **No-regression (CRITICAL):** snapshot the set of `{lineId -> logoFile}` BEFORE your change is not available, so
   instead assert: every line that has a logo has one whose filename matches its operator family (no cross-family
   leak), and total logo count ≥ 300 (we expect a rise from 227; fail if it DROPS below today's 227).
3. **Operator-family invariant:** for every line with an attached logo, the filename matches the line's operator
   family tokens (JR lines only — non-JR exempt). Fail the build on any violation, listing offenders.
4. **Determinism:** building twice yields identical `public/rail/logo-credits.json` (you may assert by building once
   and re-building; or document that the pick uses only stable sorts).

## Done
1. `node pipeline/build-jp.ts` — report logo count (expect well above 227, target ~320).
2. `node pipeline/verify-jp.ts` and `npm test` — must pass.
3. Print FINAL STATUS: logo coverage before (227) → after (X/594), the `北陸新幹線` resolution (which symbol each
   operator variant got, or none), any operator-family violations found, and confirm `npm test` green.
4. `git add pipeline/line-style.ts pipeline/verify-jp.ts public/rail/ data/n02/jp-package.json` and commit.
