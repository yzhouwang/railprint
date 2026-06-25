# Codex engine task — assign RailLine.rank (map LOD tier 0-4) + gate

**You own:** `pipeline/` (new rank module + wire into the build) + `pipeline/verify-jp.ts`. **Do NOT touch** `src/`. No network.
Trailer: `Co-Authored-By: GPT-5.5 (Codex) <noreply@openai.com>`.

Steering already added `rank?: 0|1|2|3|4` to `RailLine` in `src/contract/types.ts` (don't edit it; rely on it).

## Goal
Assign every line a `rank` 0-4 (map level-of-detail tier) at build time. The app reveals tiers by zoom: 0 Shinkansen (national) … 4 minor (close zoom). Set `line.rank` on each line in the built package (same place `operator`/`color`/`logo` are set in `pipeline/n02-ingest.ts`, around the line object at ~line 533, using the `raw.operator` / `raw.name` / `isHSR` / station+km info in scope).

## Ranking rules (apply in order; first match wins)
1. **rank 0** if `isHSR` (Shinkansen).
2. **OVERRIDE table wins** next — a curated `Map<operator+NUL+name, rank>` for marquee lines whose heuristic would be wrong. Seed it (expand as you verify against the real 594 lines):
   - 山手線(東日本旅客鉄道)→2, 大阪環状線(西日本旅客鉄道)→2, 中央線(東日本旅客鉄道)→2, 京浜東北… (NOTE: 京浜東北/埼京/湘南新宿/上野東京 are NOT separate N02 line records — do not add them), 大阪環状→2.
3. **rank 1 (trunk)** if NOT HSR and:
   - JR operator (`…旅客鉄道`) AND `name` ends with `本線` (東海道本線, 山陽本線, 東北本線, 鹿児島本線, 中央本線, 函館本線, 日豊本線, 長崎本線, 関西本線, 信越本線, 北陸本線, 奥羽本線, 羽越本線, 室蘭本線 …), OR name ∈ a small curated JR-trunk set for trunk lines that use 線 not 本線: {常磐線, 横須賀線, 高崎線, 武蔵野線? no}. Keep this set tight — trunk = inter-city spine.
   - OR line ∈ MAJOR_PRIVATE_TRUNK (the intercity flagship of a big private operator): 近鉄(近畿日本鉄道) 大阪線/名古屋線/奈良線, 名鉄(名古屋鉄道) 名古屋本線, 小田急 小田原線, 東武 伊勢崎線/日光線/東上本線, 京急(京浜急行電鉄) 本線, 京成 本線, 南海 本線/高野線, 西鉄(西日本鉄道) 天神大牟田線, 阪急 神戸本線/宝塚本線/京都本線, 阪神 本線, 京阪 本線.
   - **Do NOT use a length>80km rule** — it wrongly promotes rural JR (只見線, 五能線, 木次線, 釧網線, 山田線, 米坂線, 飯山線, 芸備線, 指宿枕崎線, 釜石線). Those stay rank 3.
4. **rank 4 (minor)** if operator/name indicates a tram, cable, or tiny line: operator matches `軌道|電気軌道` (路面 trams: 広島電鉄, 長崎電気軌道, 岡山電気軌道, 豊橋鉄道 東田本線, とさでん, 熊本市/鹿児島市/函館市 trams, 万葉線), OR name matches `鋼索|ケーブル|索道|登山`, OR a 3rd-sector/private line with < 5 stations.
5. **rank 2 (urban)** if NOT matched above and: operator is a subway/metro (`地下鉄|市営|高速電気軌道|都市モノレール|モノレール|新交通|ライトレール`) OR operator ∈ the major-private set (京王/京成/京急/近鉄/小田急/西武/東武/相鉄/東急/南海/京阪/阪急/阪神/名鉄/西鉄) OR a JR line with high station density (stations / km above a sensible threshold, e.g. ≥ ~1.0 station/km → urban commuter).
6. **rank 3 (local)** = default (rural JR, regional private, 3rd-sector with ≥5 stations).

Tune thresholds against the real data so the histogram is sane.

## verify-jp gate (hard, counts toward failures)
- Every line has `rank` ∈ {0,1,2,3,4}. Print `rank coverage: 594/594`.
- tier-0 count == HSR line count (sanity).
- No tier is empty; print the histogram (count per tier).
- Golden spot-checks (fail if wrong): 東海道新幹線→0, 東海道本線→1, 近鉄大阪線→1, 山手線→2, 大阪環状線→2, 只見線→3 (NOT 1), and one tram (e.g. 広島電鉄 本線)→4.

## Done
1. Rebuild: `node pipeline/build-jp.ts --out public/rail/jp-2025.json`.
2. `node pipeline/verify-jp.ts` (exit 0, rank 594/594, histogram printed) and `npm test` green.
3. Commit `pipeline/* public/rail/jp-2025.json data/n02/jp-package.json`.
4. Print FINAL STATUS: the rank histogram (n per tier), the 7 golden results, and confirm verify-jp exit 0 + npm test green.
