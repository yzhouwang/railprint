// Per-line service profiles (v0.13.1 plausibility gate) — PURE DATA + init-time inversion.
//
// WHY THIS FILE EXISTS: the v0.13 capture chips padded from the flat KNOWN_TRAIN_MODELS
// list, so an empty-history rider marking 東海道新幹線 saw CR400AF…CR200J chips (user
// report 2026-07-10). Category-level gating was reviewed and rejected (Codex outside
// voice: "shinkansen category" still chips E5/E6/E7 on 東海道) — service truth is
// PER-LINE. These profiles answer one question: "which registry models can a rider
// actually board on this line in regular scheduled service?"
//
// DATA DISCIPLINE (same idiom as model-registry.ts):
//  • Basis: regular scheduled passenger service as of mid-2026 (ROSTER_BASIS_YEAR).
//    Charters, inspection trains (923/E926), test sets and freight are OUT.
//  • Every entry web-fact-checked (2026-07-10, two independent multi-agent research
//    passes + cross-examination); per-entry provenance below. Inspect before editing.
//  • Fold tokens MUST be registry CARD folds (aliases rejected) — test-enforced.
//  • This gates SUGGESTIONS ONLY. Free-text entry is never validated against it, and
//    a rider's own on-this-line history always outranks it (model-suggest G4).
//
// Graduation path: these tables are the curated v1 seed of the D13 line→model capture
// hints; the Wikidata registry pipeline (TODOS) absorbs them as an overrides file.

/** Line-major profiles for lines whose roster is a curated CLOSED set (fact-checked
 *  2026-07-10). Order within each list ≈ rider encounter frequency (used as pad order). */
const LINE_PROFILES: Readonly<Record<string, readonly string[]>> = {
  // ── 新幹線 (the 9 isHSR lines) ──────────────────────────────────────────────
  // N700A first: A-family (incl. retrofitted smallA X/K編成, which fold to the N700A card)
  // still outnumbers N700S in mid-2026; 700系 left 東海道 2020-03 (ja.wikipedia 東海道新幹線).
  'jp-東海旅客鉄道-東海道新幹線': ['N700A', 'N700S'],
  // レールスター(700系7000番台) + 500系 こだま still regular mid-2026; 500系定期は2027-01-13まで
  // (JR西日本プレス 2024-07-24 / 2025-09-11, ja.wikipedia 山陽新幹線).
  'jp-西日本旅客鉄道-山陽新幹線': ['N700S', 'N700A', 'N700', '700', '500'],
  // NO N700S on 九州 through-service as of mid-2026 (ja.wikipedia N700S系 — fact-checked,
  // easy to get wrong); N700系7000/8000番台 みずほ・さくら + 800系 つばめ (JR九州 trains page).
  'jp-九州旅客鉄道-九州新幹線': ['N700', '800'],
  // Single-type fleet: N700S-8000 Y編成 かもめ (ja.wikipedia N700S系).
  'jp-九州旅客鉄道-西九州新幹線': ['N700S'],
  // E2 restored by the 2026-03-14 改正 (10 down/8 up daily incl. 仙台以北 やまびこ) until ~E10/2030;
  // E3 つばさ regular ops ended 2025-12-24 → E8統一 (鉄道コム/マイナビ 2026-03, raillab 32267).
  'jp-東日本旅客鉄道-東北新幹線': ['E5', 'E6', 'E8', 'E2', 'H5'],
  'jp-北海道旅客鉄道-北海道新幹線': ['E5', 'H5'],
  // E7-only since 2023-03-18 改正 (とき・たにがわ統一); W7 does not run north of 高崎 in regular
  // service (ja.wikipedia 上越新幹線, railf.jp 2023-03-19).
  'jp-東日本旅客鉄道-上越新幹線': ['E7'],
  // One shared E7/W7 pool over the whole 東京–敦賀 line — both lineIds get the same list
  // (ja.wikipedia 北陸新幹線; E7 fleet ≈ 2× W7, hence E7 first).
  'jp-東日本旅客鉄道-北陸新幹線': ['E7', 'W7'],
  'jp-西日本旅客鉄道-北陸新幹線': ['E7', 'W7'],

  // ── 新幹線 trainsets on conventional (isHSR=false) lines — the shared-track hosts ──
  // Mini-shinkansen through-running: E6 こまち 盛岡—大曲—秋田, E8 つばさ 福島—新庄. These lines'
  // N02 records are conventional, so without these entries the gate would wrongly hide
  // the trains riders most remember there (ja.wikipedia 秋田新幹線 / E3系, 2026-07).
  'jp-東日本旅客鉄道-田沢湖線': ['E6'],
  'jp-東日本旅客鉄道-奥羽線': ['E8', 'E6'],
  // 青函トンネル shared section: conventional passenger service ended 2016-03; riders only
  // board E5/H5 through-runs (ja.wikipedia 海峡線).
  'jp-北海道旅客鉄道-海峡線': ['E5', 'H5'],
  // 博多総合車両所 branch — served by the 山陽 こだま pool: mostly 700系レールスター/500系, some
  // N700系・N700A P編成 (ja.wikipedia 博多南線, JR西日本プレス 2025-09-11).
  'jp-西日本旅客鉄道-博多南線': ['700', '500', 'N700', 'N700A'],

  // ── 京沪高速铁路 ────────────────────────────────────────────────────────────
  // Verified mid-2026 (zh.wikipedia 京沪高速动车组列车 2026-01): CR400AF/BF + CRH380B/CL are
  // the scheduled 本线 fleet. CR200J runs the PARALLEL conventional 京沪线, NOT the dedicated
  // HSR; CRH380A(L) only rarely covers 京沪 diagrams; CR300/CRH2/CRH3 absent. Matches the
  // registry's corridor:'jinghu' set — model-registry.test.ts pins that equivalence.
  'cn-中国铁路-京沪高速铁路': ['CR400AF', 'CR400BF', 'CRH380B', 'CRH380C'],

  // ── boot-fallback stub lines (fallback-package.ts) ─────────────────────────
  // A failed package fetch boots the 5-line offline stub with its OWN lineIds — without
  // these entries every stub line is unprofiled and the degraded boot loses all curated
  // chips (outside-voice P2). 東急東横線 stays unprofiled: no registry card serves it.
  'jr-yamanote': ['E235'],
  'jr-tokaido-shinkansen': ['N700A', 'N700S'],
  'jr-kururi': ['キハE130'],
  'cn-jinghu-hsr': ['CR400AF', 'CR400BF', 'CRH380B', 'CRH380C'],
};

/** Model-major service lines for conventional 特急・通勤・気動車 registry models
 *  (fact-checked 2026-07-10; inverted into line profiles at module init). A model
 *  appears in a line's chip pads iff that line is listed here or in LINE_PROFILES.
 *  `ubiquitous` = nationwide workhorse family whose listed lines are only the iconic
 *  ones — DOCUMENTATION of deliberate incompleteness, not a gate bypass (the gate's
 *  unprofiled-conventional country fallback already covers these families where we
 *  lack data; on PROFILED lines the curated roster is the truth — review round). */
interface ModelServiceEntry {
  readonly lines: readonly string[];
  readonly ubiquitous?: boolean;
}
const MODEL_SERVICE_LINES: Readonly<Record<string, ModelServiceEntry>> = {
  // Sunrise Izumo/Seto Tokyo–Izumoshi/Takamatsu, split at Okayama; confirmed running post 2026-03-14 revision (ja.wikipedia + sunrise-express.info/time-table, raillab.jp 2026-03)
  '285': { lines: ['jp-東日本旅客鉄道-東海道線', 'jp-東海旅客鉄道-東海道線', 'jp-西日本旅客鉄道-東海道線', 'jp-西日本旅客鉄道-山陽線', 'jp-西日本旅客鉄道-伯備線', 'jp-西日本旅客鉄道-山陰線', 'jp-西日本旅客鉄道-宇野線', 'jp-西日本旅客鉄道-本四備讃線', 'jp-四国旅客鉄道-本四備讃線', 'jp-四国旅客鉄道-予讃線'] },
  // あずさ/かいじ 東京・新宿—松本(中央線・塩尻—松本は篠ノ井線)、一部南小谷(大糸線)、富士回遊は大月から富士急行線直通 — ja.wikipedia E353系/あずさ, 2026 timetable
  'E353': { lines: ['jp-東日本旅客鉄道-中央線', 'jp-東日本旅客鉄道-篠ノ井線', 'jp-東日本旅客鉄道-大糸線', 'jp-富士山麓電気鉄道-大月線', 'jp-富士山麓電気鉄道-河口湖線'] },
  // 成田エクスプレス(成田空港—新宿/大船: 成田線・総武快速線・品鶴=横須賀線・山手貨物線経由渋谷新宿)+2024年からしおさい(東京—銚子, 総武線) — ja.wikipedia E259系/成田エクスプレス, JR東日本2025改正PR
  'E259': { lines: ['jp-東日本旅客鉄道-総武線', 'jp-東日本旅客鉄道-成田線', 'jp-東日本旅客鉄道-横須賀線', 'jp-東日本旅客鉄道-東海道線', 'jp-東日本旅客鉄道-山手線'] },
  // ひたち/ときわ 品川・上野—いわき・仙台: 常磐線が主体、日暮里—東京は東北線、東京—品川は東海道線、岩沼—仙台も東北線 — ja.wikipedia E657系/ひたち(列車)
  'E657': { lines: ['jp-東日本旅客鉄道-常磐線', 'jp-東日本旅客鉄道-東北線', 'jp-東日本旅客鉄道-東海道線'] },
  // サフィール踊り子 東京—伊豆急下田: 東海道線(東京—熱海)・伊東線(熱海—伊東)・伊豆急行線(伊東—伊豆急下田) — ja.wikipedia E261系/踊り子(列車)
  'E261': { lines: ['jp-東日本旅客鉄道-東海道線', 'jp-東日本旅客鉄道-伊東線', 'jp-伊豆急行-伊豆急行線'] },
  // いなほ 新潟—酒田・秋田(白新線+羽越線)、しらゆき 新潟—上越妙高・新井(信越線+直江津からえちごトキめき鉄道妙高はねうまライン) — ja.wikipedia E653系/いなほ/しらゆき, えちごトキめき鉄道2026時刻
  'E653': { lines: ['jp-東日本旅客鉄道-羽越線', 'jp-東日本旅客鉄道-白新線', 'jp-東日本旅客鉄道-信越線', 'jp-えちごトキめき鉄道-妙高はねうまライン'] },
  // Ltd exp Shinano Nagoya–Nagano via Chuo(JRC)/Shinonoi/Shin'etsu + Home Liner Mizunami; Osaka run ended 2016 (ja.wikipedia 383系, JR東海 route page)
  '383': { lines: ['jp-東海旅客鉄道-中央線', 'jp-東日本旅客鉄道-篠ノ井線', 'jp-東日本旅客鉄道-信越線'] },
  // Hida Nagoya/Osaka–Takayama–Toyama; Nanki Nagoya–Kiikatsuura via Ise Railway; Sugihara–Inotani washout (2026-03-18) restored 2026-05-30, Toyama service resumed (railf.jp, rail.hobidas.com, JR東海 route page)
  'HC85': { lines: ['jp-東海旅客鉄道-高山線', 'jp-東海旅客鉄道-東海道線', 'jp-東海旅客鉄道-関西線', 'jp-東海旅客鉄道-紀勢線', 'jp-西日本旅客鉄道-東海道線', 'jp-西日本旅客鉄道-高山線', 'jp-伊勢鉄道-伊勢線', 'jp-西日本旅客鉄道-紀勢線'] },
  // ja.wikipedia JR西日本683系電車 + サンダーバード/しらさぎ列車記事; post-2024-03 敦賀打ち切り体制. サンダーバード大阪–敦賀(東海道・湖西・北陸), しらさぎ名古屋/米原–敦賀(JR海東海道・北陸)+らくラクびわこ/ホームライナー大垣, 能登かがり火金沢–和倉温泉(IRいしかわ・七尾線).
  '683': { lines: ['jp-西日本旅客鉄道-東海道線', 'jp-西日本旅客鉄道-湖西線', 'jp-西日本旅客鉄道-北陸線', 'jp-東海旅客鉄道-東海道線', 'jp-IRいしかわ鉄道-IRいしかわ鉄道線', 'jp-西日本旅客鉄道-七尾線'] },
  // ja.wikipedia JR西日本289系電車 + 2025.3改正運用表(big.or.jp/~hagi): 吹田京都支所=くろしお(京都/新大阪–白浜・新宮), 福知山支所=こうのとり(新大阪–城崎温泉)・きのさき(京都–城崎温泉).
  '289': { lines: ['jp-西日本旅客鉄道-東海道線', 'jp-西日本旅客鉄道-阪和線', 'jp-西日本旅客鉄道-大阪環状線', 'jp-西日本旅客鉄道-紀勢線', 'jp-西日本旅客鉄道-福知山線', 'jp-西日本旅客鉄道-山陰線'] },
  // ja.wikipedia JR西日本287系電車 + 2025.3改正FA編成運用表: こうのとり(東海道・福知山・山陰), きのさき(山陰), まいづる(舞鶴線), はしだて(京都丹後鉄道宮福線・宮津線 宮津–天橋立直通), 日根野のHC編成くろしお/パンダくろしお(東海道・環状・阪和・紀勢).
  '287': { lines: ['jp-西日本旅客鉄道-東海道線', 'jp-西日本旅客鉄道-山陰線', 'jp-西日本旅客鉄道-阪和線', 'jp-西日本旅客鉄道-大阪環状線', 'jp-西日本旅客鉄道-紀勢線', 'jp-西日本旅客鉄道-福知山線', 'jp-西日本旅客鉄道-舞鶴線', 'jp-WILLERTRAINS-宮福線', 'jp-WILLERTRAINS-宮津線'] },
  // ja.wikipedia JR西日本273系電車/やくも: 2024.4就役、やくも岡山–出雲市(山陽線岡山–倉敷、伯備線全線、山陰線伯耆大山–出雲市)。全定期やくもが273系化済み。
  '273': { lines: ['jp-西日本旅客鉄道-山陽線', 'jp-西日本旅客鉄道-伯備線', 'jp-西日本旅客鉄道-山陰線'] },
  // ja.wikipedia JR西日本271系電車/はるか: 281系はるかの増結用3連、京都(一部野洲・草津)–関西空港。東海道線・梅田貨物線・大阪環状線(西九条)・阪和線・関西空港線経由。
  '271': { lines: ['jp-西日本旅客鉄道-阪和線', 'jp-西日本旅客鉄道-関西空港線', 'jp-西日本旅客鉄道-大阪環状線', 'jp-西日本旅客鉄道-東海道線'] },
  // ja.wikipedia JR西日本283系電車 + 207hd.com 2026年改正くろしお運用まとめ: オーシャンアロー編成、くろしお一部定期運用(新大阪–白浜・新宮系統)を2026年も継続、30周年企画2026.7発表。
  '283': { lines: ['jp-西日本旅客鉄道-阪和線', 'jp-西日本旅客鉄道-紀勢線', 'jp-西日本旅客鉄道-大阪環状線', 'jp-西日本旅客鉄道-東海道線'] },
  // ja.wikipedia JR九州787系電車 (2025-26 services: リレーかもめ/かささぎ/みどり101・102/きらめき/かいおう/にちりん/ひゅうが/きりしま/宮崎地区普通/36ぷらす3) cross-checked with JR九州 service pages
  '787': { lines: ['jp-九州旅客鉄道-鹿児島線', 'jp-九州旅客鉄道-日豊線', 'jp-九州旅客鉄道-長崎線', 'jp-九州旅客鉄道-佐世保線', 'jp-九州旅客鉄道-宮崎空港線', 'jp-九州旅客鉄道-日南線', 'jp-九州旅客鉄道-篠栗線', 'jp-九州旅客鉄道-筑豊線'] },
  // ja.wikipedia JR九州883系電車 — sole regular service is ソニック 博多/中津–大分 (佐伯 extension ended 2018); 鹿児島本線 博多–小倉 + 日豊本線 小倉–大分
  '883': { lines: ['jp-九州旅客鉄道-鹿児島線', 'jp-九州旅客鉄道-日豊線'] },
  // ja.wikipedia JR九州885系電車 — ソニック (博多–大分), リレーかもめ/みどり(リレーかもめ) (博多–武雄温泉/佐世保 via 長崎本線・佐世保線), かささぎ (博多–肥前鹿島), きらめき (門司港–博多)
  '885': { lines: ['jp-九州旅客鉄道-鹿児島線', 'jp-九州旅客鉄道-日豊線', 'jp-九州旅客鉄道-長崎線', 'jp-九州旅客鉄道-佐世保線'] },
  // JR北海道 train guides (tr033/tr013/tr012) + ja.wikipedia 789系/カムイ: ライラック・カムイ 札幌-旭川 (函館線), すずらん 札幌-室蘭 (函館線 札幌-白石, 千歳線, 室蘭線), as of 2025-03 revision, still current mid-2026
  '789': { lines: ['jp-北海道旅客鉄道-函館線', 'jp-北海道旅客鉄道-千歳線', 'jp-北海道旅客鉄道-室蘭線'] },
  // JR北海道 列車ガイド (北斗/おおぞら/とかち/宗谷) + ja.wikipedia キハ261系: 北斗 札幌-函館 (千歳・室蘭・函館線), おおぞら/とかち 札幌-釧路/帯広 (千歳・石勝・根室線), 宗谷/サロベツ (函館線 札幌-旭川 + 宗谷線)
  'キハ261': { lines: ['jp-北海道旅客鉄道-千歳線', 'jp-北海道旅客鉄道-函館線', 'jp-北海道旅客鉄道-室蘭線', 'jp-北海道旅客鉄道-石勝線', 'jp-北海道旅客鉄道-根室線', 'jp-北海道旅客鉄道-宗谷線'] },
  // JR四国 official + Shikoku レールノート 8600系運用 (2025-03 revision): しおかぜ 岡山-松山 via 宇野線・瀬戸大橋(本四備讃線)・予讃線, いしづち 高松-松山 (予讃線)
  '8600': { lines: ['jp-四国旅客鉄道-予讃線', 'jp-四国旅客鉄道-本四備讃線', 'jp-西日本旅客鉄道-本四備讃線', 'jp-西日本旅客鉄道-宇野線'] },
  // ja.wikipedia あしずり/南風 + tosakuro.com 2700系 page + 鉄道コム 2025-03 改正: 南風 岡山-高知 (宇野・本四備讃・予讃 宇多津-多度津・土讃線), しまんと 高松-高知, うずしお 高松-徳島 (高徳線), あしずり 高知-中村/宿毛 直通 (土佐くろしお中村・宿毛線, 4往復 2700系)
  '2700': { lines: ['jp-四国旅客鉄道-土讃線', 'jp-四国旅客鉄道-高徳線', 'jp-四国旅客鉄道-予讃線', 'jp-四国旅客鉄道-本四備讃線', 'jp-西日本旅客鉄道-本四備讃線', 'jp-西日本旅客鉄道-宇野線', 'jp-土佐くろしお鉄道-中村線', 'jp-土佐くろしお鉄道-宿毛線'] },
  // ja.wikipedia 近鉄80000系電車 + kintetsu.co.jp ひのとり: 名阪甲特急 大阪難波-近鉄名古屋 (難波線・大阪線・名古屋線) 全列車 + 阪奈特急 大阪難波-近鉄奈良 平日4往復/土休日1往復 (難波線・大阪線上本町-布施・奈良線)
  '80000': { lines: ['jp-近畿日本鉄道-大阪線', 'jp-近畿日本鉄道-名古屋線', 'jp-近畿日本鉄道-難波線', 'jp-近畿日本鉄道-奈良線'] },
  // ja.wikipedia 近鉄50000系電車 + kintetsu.co.jp しまかぜ: 大阪難波発(難波線・大阪線)、京都発(京都線・橿原線・新ノ口連絡線・大阪線)、名古屋発(名古屋線)の3系統が各1日1往復で賢島へ(山田線・鳥羽線・志摩線)
  '50000': { lines: ['jp-近畿日本鉄道-大阪線', 'jp-近畿日本鉄道-山田線', 'jp-近畿日本鉄道-鳥羽線', 'jp-近畿日本鉄道-志摩線', 'jp-近畿日本鉄道-難波線', 'jp-近畿日本鉄道-名古屋線', 'jp-近畿日本鉄道-京都線', 'jp-近畿日本鉄道-橿原線'] },
  // ja.wikipedia 南海50000系電車 + nankai.co.jp 特急ラピート: なんば-関西空港の空港特急専用運用 (南海本線 なんば-泉佐野 + 空港線)
  '南海50000': { lines: ['jp-南海電気鉄道-南海本線', 'jp-南海電気鉄道-空港線'] },
  // Skyliner: Ueno–Narita Airport via Sky Access (成田空港線); Morning/Evening Liner via Keisei Main Line — keisei.co.jp + ja.wikipedia スカイライナー/京成成田空港線 (2026)
  'AE': { lines: ['jp-京成電鉄-成田空港線', 'jp-京成電鉄-本線'] },
  // Spacia X: Asakusa–Tobu-Nikko / Kinugawa-Onsen (Isesaki Line Asakusa–Tobu-Dobutsu-Koen, Nikko Line, Kinugawa Line Shimo-Imaichi–Kinugawa-Onsen) — tobu.co.jp/spaciax + ja.wikipedia 東武N100系 (2026)
  'N100': { lines: ['jp-東武鉄道-伊勢崎線', 'jp-東武鉄道-日光線', 'jp-東武鉄道-鬼怒川線'] },
  // Laview: ちちぶ (Ikebukuro–Seibu-Chichibu via Ikebukuro Line + Seibu Chichibu Line) and むさし (Ikebukuro–Hanno) — seiburailway.jp + ja.wikipedia 西武001系/ちちぶ(列車) (2026)
  '001': { lines: ['jp-西武鉄道-池袋線', 'jp-西武鉄道-西武秩父線'] },
  // GSE: はこね/スーパーはこね Shinjuku–Hakone-Yumoto (Odawara Line + Odakyu-Hakone line), plus さがみ/モーニングウェイ/ホームウェイ/えのしま; ja.wikipedia 小田急70000形 states regular runs as of 2026-03 cover 小田原線・江ノ島線・小田急箱根線 — cross-checked odakyu.jp
  '70000': { lines: ['jp-小田急電鉄-小田原線', 'jp-小田急箱根-鉄道線', 'jp-小田急電鉄-江ノ島線'] },
  // ja.wikipedia 名鉄2000系電車 + meitetsu.co.jp: 全列車 中部国際空港-(空港線・常滑線)-神宮前-(名古屋本線)-名鉄名古屋; 朝夕に名鉄岐阜(名古屋本線)・新鵜沼(犬山線)直通と新可児→犬山(広見線)の定期運用あり
  '2000': { lines: ['jp-名古屋鉄道-常滑線', 'jp-名古屋鉄道-空港線', 'jp-名古屋鉄道-名古屋本線', 'jp-名古屋鉄道-犬山線', 'jp-名古屋鉄道-広見線'] },
  // E235-0 Yamanote; E235-1000 Yokosuka/Sobu Rapid with through runs to Uchibo(Kimitsu), Sotobo(Kazusa-Ichinomiya), Narita(incl. airport)/Kashima lines — JR East press 2020-11-12 + ja.wikipedia E235系, checked 2026-07
  'E235': { lines: ['jp-東日本旅客鉄道-山手線', 'jp-東日本旅客鉄道-横須賀線', 'jp-東日本旅客鉄道-総武線', 'jp-東日本旅客鉄道-内房線', 'jp-東日本旅客鉄道-外房線', 'jp-東日本旅客鉄道-成田線', 'jp-東日本旅客鉄道-鹿島線'] },
  // E233 subseries 0/1000/2000/3000/5000/6000/7000/8000 cover Chuo Rapid, Keihin-Tohoku (Tohoku+Tokaido+Negishi), Joban Local w/ Chiyoda+Odakyu through, Ueno-Tokyo/Shonan-Shinjuku, Keiyo, Yokohama, Saikyo (Akabane+Kawagoe+Rinkai+Sotetsu), Nambu — ja.wikipedia E233系, checked 2026-07
  'E233': { lines: ['jp-東日本旅客鉄道-中央線', 'jp-東日本旅客鉄道-東海道線', 'jp-東日本旅客鉄道-東北線', 'jp-東日本旅客鉄道-根岸線', 'jp-東日本旅客鉄道-常磐線', 'jp-東日本旅客鉄道-京葉線', 'jp-東日本旅客鉄道-横浜線', 'jp-東日本旅客鉄道-南武線', 'jp-東日本旅客鉄道-高崎線', 'jp-東日本旅客鉄道-青梅線', 'jp-東京地下鉄-9号線千代田線', 'jp-小田急電鉄-小田原線', 'jp-東日本旅客鉄道-赤羽線', 'jp-東日本旅客鉄道-川越線', 'jp-東京臨海高速鉄道-臨海副都心線', 'jp-東日本旅客鉄道-五日市線', 'jp-相模鉄道-相鉄新横浜線', 'jp-相模鉄道-相鉄本線', 'jp-東日本旅客鉄道-伊東線', 'jp-東日本旅客鉄道-両毛線', 'jp-東日本旅客鉄道-外房線', 'jp-東日本旅客鉄道-内房線', 'jp-東日本旅客鉄道-東金線'], ubiquitous: true },
  // E231-1000 Tokaido/Utsunomiya/Takasaki + Ueno-Tokyo & Shonan-Shinjuku (Yokosuka side to Zushi); E231-0/500 Chuo-Sobu Local, Joban Rapid w/ Narita(Abiko) through, Musashino w/ Keiyo through; E231-800 Tozai through; E231-3000 Hachiko/Kawagoe — ja.wikipedia E231系, checked 2026-07
  'E231': { lines: ['jp-東日本旅客鉄道-東海道線', 'jp-東日本旅客鉄道-東北線', 'jp-東日本旅客鉄道-高崎線', 'jp-東日本旅客鉄道-総武線', 'jp-東日本旅客鉄道-中央線', 'jp-東日本旅客鉄道-常磐線', 'jp-東日本旅客鉄道-武蔵野線', 'jp-東日本旅客鉄道-京葉線', 'jp-東日本旅客鉄道-横須賀線', 'jp-東日本旅客鉄道-成田線', 'jp-東京地下鉄-5号線東西線', 'jp-東日本旅客鉄道-八高線', 'jp-東日本旅客鉄道-川越線', 'jp-東日本旅客鉄道-伊東線', 'jp-東日本旅客鉄道-両毛線'], ubiquitous: true },
  // ja.wikipedia JR西日本323系電車: 大阪環状線・桜島線(JRゆめ咲線)専用の環状線用車。大和路線・阪和線直通の環状線乗り入れは221/223/225系のため323系は2線のみ。
  '323': { lines: ['jp-西日本旅客鉄道-大阪環状線', 'jp-西日本旅客鉄道-桜島線'] },
  // Post 2026-03 revision: withdrawn from 中央線名古屋口(2023)/関西線/武豊線 (all 315系); remains on Tokaido (Atami–Maibara), Gotemba, Minobu, Iida + through to Chino/Matsumoto over JR East Chuo/Shinonoi via Tatsuno (ja.wikipedia 313系, train-times.net)
  '313': { lines: ['jp-東海旅客鉄道-東海道線', 'jp-東海旅客鉄道-御殿場線', 'jp-東海旅客鉄道-身延線', 'jp-東海旅客鉄道-飯田線', 'jp-東日本旅客鉄道-中央線', 'jp-東日本旅客鉄道-篠ノ井線', 'jp-東海旅客鉄道-中央線'] },
  // ja.wikipedia JR西日本227系電車 + railf.jp 2025.9.20(Urara区間拡大: 山陽姫路–三原・赤穂線・宇野みなと線・瀬戸大橋線茶屋町–児島・伯備線新見以南) + 鉄道チャンネル(2026.3.14改正で伯備線経由の山陰線乗り入れ開始)。0番台Red Wing=広島(山陽・呉・可部)、1000番台=和歌山線・桜井線・紀勢線和歌山地区。
  '227': { lines: ['jp-西日本旅客鉄道-山陽線', 'jp-西日本旅客鉄道-呉線', 'jp-西日本旅客鉄道-可部線', 'jp-西日本旅客鉄道-赤穂線', 'jp-西日本旅客鉄道-宇野線', 'jp-西日本旅客鉄道-本四備讃線', 'jp-西日本旅客鉄道-伯備線', 'jp-西日本旅客鉄道-和歌山線', 'jp-西日本旅客鉄道-桜井線', 'jp-西日本旅客鉄道-紀勢線', 'jp-西日本旅客鉄道-山陰線'], ubiquitous: true },
  // JR West Toyama-to-Yamaguchi fleet + JR Kyushu southern lines + Donan Isaribi; JR Hokkaido regular service ended Mar 2026 — tetsudo.com/toyokeizai kiha40 surveys + Yahoo News expert, checked 2026-07
  'キハ40': { lines: ['jp-西日本旅客鉄道-山陰線', 'jp-西日本旅客鉄道-津山線', 'jp-西日本旅客鉄道-境線', 'jp-西日本旅客鉄道-芸備線', 'jp-西日本旅客鉄道-因美線', 'jp-西日本旅客鉄道-播但線', 'jp-西日本旅客鉄道-山口線', 'jp-西日本旅客鉄道-岩徳線', 'jp-西日本旅客鉄道-城端線', 'jp-西日本旅客鉄道-氷見線', 'jp-九州旅客鉄道-日南線', 'jp-九州旅客鉄道-指宿枕崎線', 'jp-九州旅客鉄道-吉都線', 'jp-九州旅客鉄道-肥薩線', 'jp-道南いさりび鉄道-道南いさりび鉄道線', 'jp-四国旅客鉄道-高徳線', 'jp-四国旅客鉄道-鳴門線', 'jp-四国旅客鉄道-徳島線'], ubiquitous: true },
  // 0-series Suigun, 100-series Kururi, 500-series Hachinohe — ja.wikipedia キハE130系 + JR East, checked 2026-07
  'キハE130': { lines: ['jp-東日本旅客鉄道-水郡線', 'jp-東日本旅客鉄道-久留里線', 'jp-東日本旅客鉄道-八戸線'] },
  // Niigata: Haetsu(Niitsu–Sakata)/Shin'etsu(Niigata–Niitsu)/Ban'etsu-West/Yonesaka; Akita: Gono + Ou (Shinjo–Akita–Higashi-Noshiro from Apr 2025, Hirosaki–Kawabe) — ja.wikipedia GV-E400系 + 2nd-train 2025-03, checked 2026-07
  'GVE400': { lines: ['jp-東日本旅客鉄道-五能線', 'jp-東日本旅客鉄道-羽越線', 'jp-東日本旅客鉄道-信越線', 'jp-東日本旅客鉄道-磐越西線', 'jp-東日本旅客鉄道-奥羽線', 'jp-東日本旅客鉄道-米坂線'] },
  // キハ100/110 family across JR East rural lines; 大船渡線 fully キハ110 since Mar 2025 — ja.wikipedia キハ100系・キハ110系 + RailLab, checked 2026-07
  'キハ110': { lines: ['jp-東日本旅客鉄道-小海線', 'jp-東日本旅客鉄道-飯山線', 'jp-東日本旅客鉄道-磐越東線', 'jp-東日本旅客鉄道-陸羽東線', 'jp-東日本旅客鉄道-石巻線', 'jp-東日本旅客鉄道-只見線', 'jp-東日本旅客鉄道-気仙沼線', 'jp-東日本旅客鉄道-大船渡線', 'jp-東日本旅客鉄道-北上線', 'jp-東日本旅客鉄道-山田線', 'jp-東日本旅客鉄道-花輪線', 'jp-東日本旅客鉄道-陸羽西線', 'jp-アイジーアールいわて銀河鉄道-いわて銀河鉄道線'], ubiquitous: true },

  // ── 2026-07-11 expansion sweep (see model-registry.ts expansion header) ──
  // ja.wikipedia.org/wiki/JR北海道キハ283系気動車; railf.jp 2023-03-18 news on キハ283系 taking over オホーツク/大雪; railf.jp 2025-03-15 on 大雪's downgrade to rapid
  'キハ283': { lines: ['jp-北海道旅客鉄道-函館線', 'jp-北海道旅客鉄道-石北線', 'jp-北海道旅客鉄道-宗谷線'] },
  // ja.wikipedia.org/wiki/E257系 + JR東日本公式列車ページ (草津・四万/あかぎ, わかしお/さざなみ/しおさい)
  'E257': { lines: ['jp-東日本旅客鉄道-高崎線', 'jp-東日本旅客鉄道-上越線', 'jp-東日本旅客鉄道-吾妻線', 'jp-東日本旅客鉄道-東北線', 'jp-東日本旅客鉄道-外房線', 'jp-東日本旅客鉄道-内房線', 'jp-東日本旅客鉄道-総武線', 'jp-東日本旅客鉄道-成田線', 'jp-伊豆急行-伊豆急行線', 'jp-東日本旅客鉄道-東海道線', 'jp-伊豆箱根鉄道-駿豆線'] },
  // ja.wikipedia.org/JR東海373系電車; railway.jr-central.co.jp/train/express/detail_02_03/ (運行区間: ふじかわ 静岡~甲府, 伊那路 豊橋~飯田, ホームライナー 静岡地区)
  '373': { lines: ['jp-東海旅客鉄道-東海道線', 'jp-東海旅客鉄道-身延線', 'jp-東海旅客鉄道-飯田線'] },
  // ja.wikipedia.org/wiki/JR西日本281系電車; mynavi.jp 2026-05 article confirms 281/271 are still はるか's primary+supplement fleet with new-vehicle plan not yet d
  '281': { lines: ['jp-西日本旅客鉄道-東海道線', 'jp-西日本旅客鉄道-大阪環状線', 'jp-西日本旅客鉄道-阪和線', 'jp-西日本旅客鉄道-関西空港線'] },
  // ja.wikipedia.org/wiki/JR西日本681系電車; kumoyuni45.net 2026 tracking piece on remaining しらさぎ 681系 sets after 2024 Hokuriku Shinkansen Tsuruga extension shr
  '681': { lines: ['jp-東海旅客鉄道-東海道線', 'jp-西日本旅客鉄道-北陸線'] },
  // ja.wikipedia.org/wiki/JR西日本キハ189系気動車; tetsumin.com series feature confirms 2026-03 timetable with Osaka-Tottori/Kasumi/Toyooka/Kinosaki-Onsen workings
  'キハ189': { lines: ['jp-西日本旅客鉄道-東海道線', 'jp-西日本旅客鉄道-山陽線', 'jp-西日本旅客鉄道-播但線', 'jp-西日本旅客鉄道-山陰線'] },
  // ja.wikipedia.org/wiki/スーパーまつかぜ; nrtlog.com service-comparison piece confirming スーパーおき runs San'in-line through to Shin-Yamaguchi (山陽線 tail) while スーパー
  'キハ187': { lines: ['jp-西日本旅客鉄道-山陰線', 'jp-西日本旅客鉄道-山陽線', 'jp-西日本旅客鉄道-山口線', 'jp-智頭急行-智頭線', 'jp-西日本旅客鉄道-因美線'] },
  // ja.wikipedia.org/wiki/智頭急行HOT7000系気動車; chizukyu.co.jp official スーパーはくと vehicle page confirms Kyoto/Osaka-Tottori/Kurayoshi through-running via JR San'
  'HOT7000': { lines: ['jp-西日本旅客鉄道-東海道線', 'jp-西日本旅客鉄道-山陽線', 'jp-智頭急行-智頭線', 'jp-西日本旅客鉄道-山陰線', 'jp-西日本旅客鉄道-因美線'] },
  // ja.wikipedia.org/wiki/JR四国8000系電車; jr-shikoku.co.jp vehicle page — 1993 production debut replacing DMU しおかぜ/いしづち services, controlled pendulum tilt, 1
  '8000': { lines: ['jp-四国旅客鉄道-予讃線', 'jp-四国旅客鉄道-本四備讃線', 'jp-西日本旅客鉄道-宇野線'] },
  // ja.wikipedia.org/wiki/JR四国2600系気動車; shikoku-railway-note.com — only 4 cars built (2017) after air-spring tilt issues on the 土讃線 halted mass production
  '2600': { lines: ['jp-四国旅客鉄道-高徳線'] },
  // ja.wikipedia.org/wiki/国鉄キハ185系気動車; train-times.net / shikoku-railway-note.com 2026 — down to 3.5 round trips on 特急剣山 after March 2025 revision dropped
  'キハ185': { lines: ['jp-四国旅客鉄道-徳島線', 'jp-四国旅客鉄道-高徳線'] },
  // ja.wikipedia.org/wiki/JR九州783系電車; toyokeizai.net 2025 feature — JR's first 特急 EMU with center-entry doors and rotating seats; since the 2022 西九州新幹線 op
  '783': { lines: ['jp-九州旅客鉄道-長崎線', 'jp-九州旅客鉄道-佐世保線', 'jp-九州旅客鉄道-大村線', 'jp-九州旅客鉄道-鹿児島線'] },
  // ja.wikipedia.org/wiki/JR九州キハ71系気動車; ja.wikipedia.org/wiki/JR九州キハ72系気動車; toretabi.jp — キハ71系 debuted March 1989 for the 久大本線 resort 特急ゆふいんの森 between Fu
  'キハ71': { lines: ['jp-九州旅客鉄道-久大線', 'jp-九州旅客鉄道-鹿児島線', 'jp-九州旅客鉄道-日豊線'] },
  // ja.wikipedia.org/東武500系電車; tobu.co.jp special_express/vehicle/revaty — 2017 debut, 120km/h service max, Nikko/Kinugawa/Isesaki/Noda lines + Aizu throu
  '東武500': { lines: ['jp-東武鉄道-伊勢崎線', 'jp-東武鉄道-日光線', 'jp-東武鉄道-鬼怒川線', 'jp-東武鉄道-桐生線', 'jp-野岩鉄道-会津鬼怒川線', 'jp-会津鉄道-会津線'] },
  // ja.wikipedia.org/東武200系電車; tobu.co.jp special_express/vehicle/ryomo — 1991 debut (rebuilt from 1720系), 110km/h, Asakusa–Akagi via Isesaki/Kiryu lines,
  '東武200': { lines: ['jp-東武鉄道-伊勢崎線', 'jp-東武鉄道-桐生線'] },
  // ja.wikipedia.org/東武100系電車; tetsudo-ch.com 2026 column on 100系 phased retirement — 1990 debut, 120km/h, Nikko/Kinugawa lines plus Skytree Liner
  '東武100': { lines: ['jp-東武鉄道-日光線', 'jp-東武鉄道-鬼怒川線', 'jp-東武鉄道-伊勢崎線'] },
  // ja.wikipedia.org/小田急30000形電車; odakyu.jp EXE 30th-anniversary (2026-03-23) — 1996 debut, 110km/h, Odakyu main/Enoshima lines with Hakone-Tozan through-
  '小田急30000': { lines: ['jp-小田急電鉄-小田原線', 'jp-小田急電鉄-江ノ島線', 'jp-小田急箱根-鉄道線'] },
  // ja.wikipedia.org/小田急60000形電車; tetsudo.com event listings May–June 2026 on MSE service changes — 2008 debut, 110km/h on Odakyu lines (80km/h under Toky
  '小田急60000': { lines: ['jp-小田急電鉄-小田原線', 'jp-小田急電鉄-江ノ島線', 'jp-東京地下鉄-9号線千代田線', 'jp-東海旅客鉄道-御殿場線', 'jp-小田急箱根-鉄道線', 'jp-小田急電鉄-多摩線'] },
  // ja.wikipedia.org/京急2100形電車 — 1998 debut, 120km/h, 2-door cross-seat flagship running 快特 on Main/Kurihama lines, Siemens inverter 'singing train' nickn
  '京急2100': { lines: ['jp-京浜急行電鉄-本線', 'jp-京浜急行電鉄-久里浜線', 'jp-京浜急行電鉄-空港線'] },
  // ja.wikipedia.org/wiki/近鉄21000系電車, cross-checked with 近鉄公式 車両紹介
  '近鉄21000': { lines: ['jp-近畿日本鉄道-難波線', 'jp-近畿日本鉄道-大阪線', 'jp-近畿日本鉄道-名古屋線'] },
  // ja.wikipedia.org/wiki/近鉄30000系電車; 2024年時点の配置本数を確認
  '近鉄30000': { lines: ['jp-近畿日本鉄道-大阪線', 'jp-近畿日本鉄道-名古屋線', 'jp-近畿日本鉄道-山田線', 'jp-近畿日本鉄道-鳥羽線', 'jp-近畿日本鉄道-志摩線', 'jp-近畿日本鉄道-京都線', 'jp-近畿日本鉄道-奈良線', 'jp-近畿日本鉄道-橿原線'] },
  // ja.wikipedia.org/wiki/近鉄26000系電車
  '近鉄26000': { lines: ['jp-近畿日本鉄道-南大阪線', 'jp-近畿日本鉄道-吉野線'] },
  // ja.wikipedia.org/wiki/近鉄23000系電車; 2024年時点で6編成36両全車運用中を確認
  '近鉄23000': { lines: ['jp-近畿日本鉄道-難波線', 'jp-近畿日本鉄道-大阪線', 'jp-近畿日本鉄道-名古屋線', 'jp-近畿日本鉄道-山田線', 'jp-近畿日本鉄道-鳥羽線', 'jp-近畿日本鉄道-志摩線', 'jp-近畿日本鉄道-京都線', 'jp-近畿日本鉄道-奈良線', 'jp-近畿日本鉄道-橿原線'] },
  // ja.wikipedia.org/wiki/近鉄22000系電車; 標準軌用22600系は同ブランドの後継形式としてaliasesに集約
  '近鉄22000': { lines: ['jp-近畿日本鉄道-大阪線', 'jp-近畿日本鉄道-名古屋線', 'jp-近畿日本鉄道-奈良線', 'jp-近畿日本鉄道-京都線', 'jp-近畿日本鉄道-橿原線'] },
  // ja.wikipedia.org/wiki/近鉄16600系電車 — 22600系の狭軌仕様版と明記
  '近鉄16600': { lines: ['jp-近畿日本鉄道-南大阪線', 'jp-近畿日本鉄道-吉野線'] },
  // ja.wikipedia.org/wiki/南海30000系電車 + 南海31000系電車; 2025年4月時点の在籍数を確認
  '南海30000': { lines: ['jp-南海電気鉄道-高野線'] },
  // ja.wikipedia.org/wiki/南海12000系電車; 2025年4月の泉北高速鉄道合併後の在籍を確認
  '南海12000': { lines: ['jp-南海電気鉄道-南海本線', 'jp-南海電気鉄道-和歌山港線', 'jp-南海電気鉄道-泉北線'] },
  // ja.wikipedia.org/wiki/名鉄2200系電車
  '名鉄2200': { lines: ['jp-名古屋鉄道-名古屋本線', 'jp-名古屋鉄道-犬山線', 'jp-名古屋鉄道-空港線', 'jp-名古屋鉄道-常滑線', 'jp-名古屋鉄道-河和線', 'jp-名古屋鉄道-知多新線', 'jp-名古屋鉄道-豊川線'] },
  // ja.wikipedia.org/wiki/名鉄1000系電車 — 全車特別車の1000系単独編成は2008年に運用終了、現存は1000-1200系(一部特別車)のみ
  '名鉄1200': { lines: ['jp-名古屋鉄道-名古屋本線'] },
  // ja.wikipedia.org/wiki/京阪8000系電車; プレミアムカー導入2017年8月を確認
  '京阪8000': { lines: ['jp-京阪電気鉄道-京阪本線', 'jp-京阪電気鉄道-鴨東線'] },
  // ja.wikipedia.org/wiki/京阪3000系電車_(2代); プレミアムカー2両編成化(2025年10月)を確認
  '京阪3000': { lines: ['jp-京阪電気鉄道-京阪本線', 'jp-京阪電気鉄道-鴨東線'] },
  // ja.wikipedia.org/wiki/阪急2300系電車_(2代); 2026年4月時点の運用両数を確認
  '阪急2300': { lines: ['jp-阪急電鉄-京都線'] },
  // ja.wikipedia.org/wiki/阪急9300系電車; 2026年4月時点で11本88両、うち5本にPRiVACE連結を確認
  '阪急9300': { lines: ['jp-阪急電鉄-京都線'] },
  // ja.wikipedia.org/wiki/西鉄3000形電車; 日中特急は原則3000形運行と確認
  '西鉄3000': { lines: ['jp-西日本鉄道-天神大牟田線', 'jp-西日本鉄道-太宰府線'] },
  // ja.wikipedia 富士山麓電気鉄道; response.jp 2016/04/06 report
  '富士急8500': { lines: ['jp-富士山麓電気鉄道-大月線', 'jp-富士山麓電気鉄道-河口湖線'] },
  // ja.wikipedia 富士山麓電気鉄道; fujikyu-railway.jp fujisan-express-15anniversary
  '富士急8000': { lines: ['jp-富士山麓電気鉄道-大月線', 'jp-富士山麓電気鉄道-河口湖線'] },
  // ja.wikipedia 長野電鉄2100系電車
  '長野電鉄2100': { lines: ['jp-長野電鉄-長野線'] },
  // ja.wikipedia 長野電鉄1000系電車
  '長野電鉄1000': { lines: ['jp-長野電鉄-長野線'] },
  // ja.wikipedia 北近畿タンゴ鉄道KTR8000形気動車; trafficnews.jp/post/629892
  'KTR8000': { lines: ['jp-WILLERTRAINS-宮福線', 'jp-WILLERTRAINS-宮津線', 'jp-西日本旅客鉄道-山陰線', 'jp-西日本旅客鉄道-舞鶴線'] },
  // 世界初の振子式気動車（TSE 1989-03営業開始・量産1990〜）。N2000系（1998〜、130km/h）は同一形式内の改良グループでエイリアス統合（独立形式付与なし、公式ページも同一）。現行は宇和海（松山〜宇和島、全列車が内子線経由）ほぼ専属＋土讃線あしずり定期4往復（高知〜中村・宿毛、以
  '四国2000': { lines: ['jp-四国旅客鉄道-予讃線', 'jp-四国旅客鉄道-内子線', 'jp-四国旅客鉄道-土讃線'] },
  // 現役最古参の特急形（1965-03-18営業開始、大阪阿部野橋〜吉野）。狭軌1067mmの南大阪線・吉野線専用で、標準軌の橿原線・京都線側とは橿原神宮前で線路が繋がらず京都〜吉野系統には入らない (ja.wikipedia 近鉄16000系; kintetsu.jp/kouhou/Train/B07
  '近鉄16000': { lines: ['jp-近畿日本鉄道-南大阪線', 'jp-近畿日本鉄道-吉野線'] },
  // ja.wikipedia.org/wiki/JR北海道721系電車; jrhokkaido.co.jp train guide tr020_01 (エアポート運用車両案内)
  '721': { lines: ['jp-北海道旅客鉄道-函館線', 'jp-北海道旅客鉄道-千歳線', 'jp-北海道旅客鉄道-札沼線'] },
  // ja.wikipedia.org/wiki/JR北海道731系電車; katomodels.com 731系<いしかりライナー> product page
  '731': { lines: ['jp-北海道旅客鉄道-函館線', 'jp-北海道旅客鉄道-千歳線', 'jp-北海道旅客鉄道-札沼線'] },
  // ja.wikipedia.org/wiki/JR北海道733系電車; jrhokkaido.co.jp train guide tr020_01 (エアポート 721系・733系)
  '733': { lines: ['jp-北海道旅客鉄道-函館線', 'jp-北海道旅客鉄道-千歳線', 'jp-北海道旅客鉄道-札沼線', 'jp-北海道旅客鉄道-室蘭線'] },
  // ja.wikipedia.org/wiki/JR北海道735系電車; toretabi.jp 735系(JR北海道) feature article
  '735': { lines: ['jp-北海道旅客鉄道-函館線', 'jp-北海道旅客鉄道-札沼線'] },
  // ja.wikipedia.org/wiki/JR北海道737系電車; 2nd-train.net 737系編成表; mynavi.jp 2023-05-28 room debut report
  '737': { lines: ['jp-北海道旅客鉄道-室蘭線', 'jp-北海道旅客鉄道-函館線'] },
  // ja.wikipedia.org/wiki/JR東日本E131系電車 + JR東日本プレスリリース(2026年5月7日, 中央本線・篠ノ井線・信越本線投入)
  'E131': { lines: ['jp-東日本旅客鉄道-相模線', 'jp-東日本旅客鉄道-東北線', 'jp-東日本旅客鉄道-日光線', 'jp-東日本旅客鉄道-内房線', 'jp-東日本旅客鉄道-外房線', 'jp-東日本旅客鉄道-鹿島線', 'jp-東日本旅客鉄道-成田線', 'jp-東日本旅客鉄道-鶴見線', 'jp-東日本旅客鉄道-仙石線'] },
  // ja.wikipedia.org/wiki/JR東日本701系電車 + JR東日本公式列車ページ
  '701': { lines: ['jp-東日本旅客鉄道-東北線', 'jp-東日本旅客鉄道-奥羽線', 'jp-東日本旅客鉄道-常磐線', 'jp-東日本旅客鉄道-羽越線', 'jp-東日本旅客鉄道-田沢湖線', 'jp-東日本旅客鉄道-津軽線'] },
  // ja.wikipedia.org/wiki/JR東日本E721系電車 + 河北新報 (2026年2月, 台車ひび報道)
  'E721': { lines: ['jp-東日本旅客鉄道-東北線', 'jp-東日本旅客鉄道-常磐線', 'jp-東日本旅客鉄道-仙山線', 'jp-仙台空港鉄道-仙台空港線'] },
  // ja.wikipedia.org/wiki/JR東日本E129系電車 + JR東日本公式列車ページ
  'E129': { lines: ['jp-東日本旅客鉄道-信越線', 'jp-東日本旅客鉄道-白新線', 'jp-東日本旅客鉄道-越後線', 'jp-東日本旅客鉄道-弥彦線', 'jp-東日本旅客鉄道-羽越線', 'jp-東日本旅客鉄道-上越線'] },
  // ja.wikipedia.org/wiki/JR東日本209系電車 + 4gousya.net 配置歴/置き換え記録
  '209': { lines: ['jp-東日本旅客鉄道-武蔵野線', 'jp-東日本旅客鉄道-京葉線'] },
  // ja.wikipedia.org/wiki/JR東日本719系電車 + tetutoo28m32.hateblo.jp(2025年11月, E723系5000番台導入発表)
  '719': { lines: ['jp-東日本旅客鉄道-奥羽線'] },
  // ja.wikipedia.org/wiki/JR東日本E501系電車 + Yahoo!ニュース エキスパート記事(清水要, 2025年3月改正)
  'E501': { lines: ['jp-東日本旅客鉄道-常磐線'] },
  // ja.wikipedia.org/JR東海315系電車; railway.jr-central.co.jp/315s/; 2026-03-14 diagram revision completed full 315系 rollout on 武豊線・関西線 (train-times.net)
  '315': { lines: ['jp-東海旅客鉄道-中央線', 'jp-東海旅客鉄道-東海道線', 'jp-東海旅客鉄道-関西線', 'jp-東海旅客鉄道-武豊線'] },
  // ja.wikipedia.org/wiki/JR西日本223系電車; toretabi.jp entry-8522 — cross-checked 130km/h 新快速 role and multi-番台 fleet, mid-2026 still primary 新快速 stock
  '223': { lines: ['jp-西日本旅客鉄道-東海道線', 'jp-西日本旅客鉄道-山陽線', 'jp-西日本旅客鉄道-湖西線', 'jp-西日本旅客鉄道-北陸線', 'jp-西日本旅客鉄道-関西空港線', 'jp-西日本旅客鉄道-阪和線', 'jp-西日本旅客鉄道-赤穂線', 'jp-西日本旅客鉄道-福知山線'] },
  // ja.wikipedia.org/wiki/JR西日本225系電車; toretabi.jp entry-7303 — confirmed 130km/h capable 0/100番台 still running 新快速 alongside 223系ç, mid-2026
  '225': { lines: ['jp-西日本旅客鉄道-東海道線', 'jp-西日本旅客鉄道-山陽線', 'jp-西日本旅客鉄道-湖西線', 'jp-西日本旅客鉄道-北陸線', 'jp-西日本旅客鉄道-阪和線', 'jp-西日本旅客鉄道-関西空港線', 'jp-西日本旅客鉄道-赤穂線', 'jp-西日本旅客鉄道-福知山線'] },
  // ja.wikipedia.org/wiki/JR西日本221系電車; kansai-norikae.com miyakoji-rapid — confirmed still運用 大和路快速/みやこ路快速 as of 2026, and took over remaining 大和路線 duties 
  '221': { lines: ['jp-西日本旅客鉄道-関西線', 'jp-西日本旅客鉄道-大阪環状線', 'jp-西日本旅客鉄道-奈良線', 'jp-西日本旅客鉄道-山陰線', 'jp-西日本旅客鉄道-草津線', 'jp-西日本旅客鉄道-湖西線', 'jp-西日本旅客鉄道-東海道線', 'jp-西日本旅客鉄道-おおさか東線'] },
  // raillab.jp/series/292; ameblo.jp ra-tana entry-12958931004 — confirmed 39編成 based Aboshi/Akashi branch, still primary JR京都/神戸/宝塚/東西線 stock mid-2026
  '321': { lines: ['jp-西日本旅客鉄道-東海道線', 'jp-西日本旅客鉄道-山陽線', 'jp-西日本旅客鉄道-福知山線', 'jp-西日本旅客鉄道-JR東西線', 'jp-西日本旅客鉄道-片町線'] },
  // ja.wikipedia.org/wiki/JR西日本207系電車; railf.jp — confirmed ongoing 体質改善 (refresh) program through 2026, no retirement announced, still core JR東西線/学研都市線 f
  '207': { lines: ['jp-西日本旅客鉄道-JR東西線', 'jp-西日本旅客鉄道-片町線', 'jp-西日本旅客鉄道-福知山線', 'jp-西日本旅客鉄道-東海道線', 'jp-西日本旅客鉄道-山陽線'] },
  // ja.wikipedia.org/wiki/JR西日本521系電車; toretabi.jp entry-10627 — confirmed post-2024 Hokuriku Shinkansen extension handover split JR-West-owned units vs. 
  '521': { lines: ['jp-西日本旅客鉄道-北陸線', 'jp-西日本旅客鉄道-湖西線', 'jp-西日本旅客鉄道-七尾線', 'jp-あいの風とやま鉄道-あいの風とやま鉄道線', 'jp-IRいしかわ鉄道-IRいしかわ鉄道線', 'jp-ハピラインふくい-ハピラインふくい線'] },
  // railfromokayama2.com 2026/04/02 and 2026 hobidas rmnews/543030 — confirmed G編成 fully withdrawn July 2026, A/D編成 still in scheduled service (mainly 福塩線
  '115': { lines: ['jp-西日本旅客鉄道-福塩線', 'jp-西日本旅客鉄道-山陽線'] },
  // note.com tc221_25 113系S編成運用表(2026.3.14改正版); railscenery.ever.jp 2026-04-30 — confirmed last 5 two-car S-sets running 綾部～城崎温泉/舞鶴線/宮福線, the last schedul
  '113': { lines: ['jp-西日本旅客鉄道-山陰線', 'jp-西日本旅客鉄道-舞鶴線'] },
  // railfromokayama2.com 2026/01/29; note.com yontyokuchanel 227系導入記事 — confirmed still in daily service on 福塩線 and 宇部線/小野田線 mid-2026, no confirmed retire
  '105': { lines: ['jp-西日本旅客鉄道-福塩線', 'jp-西日本旅客鉄道-宇部線', 'jp-西日本旅客鉄道-小野田線', 'jp-西日本旅客鉄道-山陽線'] },
  // ja.wikipedia.org/wiki/JR西日本125系電車; news.mynavi.jp 20230321-2632249 — confirmed ongoing daily 小浜線/加古川線/舞鶴線 single-car operation, no retirement signal f
  '125': { lines: ['jp-西日本旅客鉄道-小浜線', 'jp-西日本旅客鉄道-加古川線', 'jp-西日本旅客鉄道-舞鶴線'] },
  // ja.wikipedia.org/wiki/JR四国5000系電車; ktm-models.co.jp — JR Shikoku's first double-decker EMU, always runs coupled with JR West's 223系5000番台 as a 5-car マ
  '5000': { lines: ['jp-四国旅客鉄道-本四備讃線', 'jp-四国旅客鉄道-予讃線', 'jp-西日本旅客鉄道-宇野線'] },
  // ja.wikipedia.org/wiki/JR四国7000系電車; toretabi.jp 7200系 feature — JR四国's first VVVF EMU family, introduced with 1990 Iyo-Hojo–Iyoshi electrification; 720
  '7000': { lines: ['jp-四国旅客鉄道-予讃線', 'jp-四国旅客鉄道-土讃線'] },
  // ja.wikipedia.org/wiki/JR九州813系電車 — 85 sets/254 cars built 1994-2009, wide use across Kagoshima/Nagasaki/Sasebo/Nippo main lines and the 福北ゆたか線 corrido
  '813': { lines: ['jp-九州旅客鉄道-鹿児島線', 'jp-九州旅客鉄道-日豊線', 'jp-九州旅客鉄道-長崎線', 'jp-九州旅客鉄道-筑豊線', 'jp-九州旅客鉄道-篠栗線'] },
  // ja.wikipedia.org/wiki/JR九州815系電車 — debuted with 1999 豊肥本線 electrification (熊本-肥後大津), also displaced 423/457/475系 on 鹿児島線熊本地区 and 日豊線大分地区
  '815': { lines: ['jp-九州旅客鉄道-豊肥線', 'jp-九州旅客鉄道-鹿児島線', 'jp-九州旅客鉄道-日豊線'] },
  // ja.wikipedia.org/wiki/JR九州817系電車 — debuted Oct 2001 with 福北ゆたか線 opening, since expanded to become JR九州's broadest-coverage AC suburban EMU family, rep
  '817': { lines: ['jp-九州旅客鉄道-鹿児島線', 'jp-九州旅客鉄道-日豊線', 'jp-九州旅客鉄道-長崎線', 'jp-九州旅客鉄道-佐世保線', 'jp-九州旅客鉄道-筑豊線', 'jp-九州旅客鉄道-豊肥線'] },
  // ja.wikipedia.org/wiki/JR九州821系電車; trafficnews.jp — commercial debut March 16 2019 as 415系 successor with SiC-MOSFET drives (~70% less power draw); as 
  '821': { lines: ['jp-九州旅客鉄道-鹿児島線', 'jp-九州旅客鉄道-筑豊線', 'jp-九州旅客鉄道-篠栗線', 'jp-九州旅客鉄道-豊肥線'] },
  // ja.wikipedia.org/wiki/JR九州811系電車 — debuted July 1989 for the Kitakyushu/Fukuoka 快速 network and 421系 replacement; 112 cars (28×4-car) built through 199
  '811': { lines: ['jp-九州旅客鉄道-鹿児島線', 'jp-九州旅客鉄道-日豊線', 'jp-九州旅客鉄道-長崎線'] },
  // ja.wikipedia.org/wiki/JR九州305系電車 — debuted Feb 2015 replacing 103系1500番台 on 筑肥線/唐津線 and through-running with Fukuoka City Subway Airport Line; manual 
  '305': { lines: ['jp-九州旅客鉄道-筑肥線', 'jp-九州旅客鉄道-唐津線'] },
  // ja.wikipedia.org/wiki/JR九州303系電車 — debuted 1999-2000 for post-double-tracking frequency increase on 筑肥線; 3 six-car sets (18 cars), ATO-equipped for th
  '303': { lines: ['jp-九州旅客鉄道-筑肥線', 'jp-九州旅客鉄道-唐津線'] },
  // ja.wikipedia.org/wiki/国鉄415系電車; railfromokayama2.com 2026 / kumoyuni45.net — only the stainless 1500番台 (built 1986, ~40 years old) survives after stee
  '415': { lines: ['jp-九州旅客鉄道-鹿児島線', 'jp-九州旅客鉄道-山陽線'] },
  // ja.wikipedia.org/京急1000形電車(2代) — 2002 debut, 120km/h, standard Keikyu commuter EMU running through Toei Asakusa line to Keisei/Narita, riders' everyda
  '京急1000': { lines: ['jp-京浜急行電鉄-本線', 'jp-京浜急行電鉄-空港線', 'jp-京浜急行電鉄-久里浜線', 'jp-京浜急行電鉄-逗子線', 'jp-京浜急行電鉄-大師線', 'jp-東京都-1号線浅草線', 'jp-京成電鉄-本線', 'jp-京成電鉄-押上線'] },
  // ja.wikipedia.org/wiki/西鉄9000形電車; 2025年4月時点で18編成43両を確認
  '西鉄9000': { lines: ['jp-西日本鉄道-天神大牟田線', 'jp-西日本鉄道-太宰府線'] },
  // ja.wikipedia しなの鉄道SR1系電車; shinanorailway.co.jp/sr1/
  'SR1': { lines: ['jp-しなの鉄道-しなの鉄道線', 'jp-しなの鉄道-北しなの線', 'jp-東日本旅客鉄道-信越線'] },
  // ja.wikipedia 富山地方鉄道16010形電車; tetsudo.com column/645
  '富山地鉄16010': { lines: ['jp-富山地方鉄道-本線', 'jp-富山地方鉄道-立山線', 'jp-富山地方鉄道-上滝線', 'jp-富山地方鉄道-不二越線'] },
  // ja.wikipedia 京阪3000系電車(初代); uraken.net 富山地方鉄道10030形
  '富山地鉄10030': { lines: ['jp-富山地方鉄道-本線', 'jp-富山地方鉄道-立山線', 'jp-富山地方鉄道-上滝線'] },
  // JR東日本初の130km/h普通列車用交直流車、2005-07-09営業開始。上野東京ライン経由で品川（東京〜品川は東海道線籍）へ定期直通、3000番台は東北線黒磯〜新白河の定期シャトルを持つ (ja.wikipedia E531系・上野東京ライン; wdic.org; trafficnews.jp
  'E531': { lines: ['jp-東日本旅客鉄道-常磐線', 'jp-東日本旅客鉄道-水戸線', 'jp-東日本旅客鉄道-東海道線', 'jp-東日本旅客鉄道-東北線'] },
  // 蓄電池電車DENCHA（DUAL ENERGY CHARGE TRAIN）、2016-10-19若松線（筑豊線若松〜折尾）デビュー、2019-03香椎線全列車置換（300番台）、2020-03改正から香椎〜博多の鹿児島線直通あり。直方配置36両で置換計画なし (ja.wikipedia BEC819
  'BEC819': { lines: ['jp-九州旅客鉄道-香椎線', 'jp-九州旅客鉄道-筑豊線', 'jp-九州旅客鉄道-鹿児島線'] },
  // JR九州筑肥線を除き国内最後の定期103系。3500番台=播但線電化1998-03-14投入（2連9本・網干配置）、3550番台=加古川線電化2004-12-19投入（貫通扉付き先頭化改造）。2026-01時点の乗車記・置換考察記事で両線とも現役を確認、原形式は1963年デビュー (ja.wikip
  '103': { lines: ['jp-西日本旅客鉄道-播但線', 'jp-西日本旅客鉄道-加古川線'] },
  // ja.wikipedia.org/wiki/JR北海道H100形気動車; jrhokkaido.co.jp 2019-09-11 press PDF on DECMO line rollout
  'H100': { lines: ['jp-北海道旅客鉄道-函館線', 'jp-北海道旅客鉄道-宗谷線', 'jp-北海道旅客鉄道-石北線', 'jp-北海道旅客鉄道-室蘭線', 'jp-北海道旅客鉄道-根室線', 'jp-北海道旅客鉄道-富良野線', 'jp-北海道旅客鉄道-釧網線'] },
  // ja.wikipedia.org/wiki/JR北海道キハ150形気動車; uraken.net キハ150形一般形気動車 feature
  'キハ150': { lines: ['jp-北海道旅客鉄道-函館線', 'jp-北海道旅客鉄道-富良野線', 'jp-北海道旅客鉄道-宗谷線', 'jp-北海道旅客鉄道-石北線', 'jp-北海道旅客鉄道-根室線'] },
  // ja.wikipedia.org/wiki/JR北海道キハ201系気動車; tetsudo.com column on the electric+diesel coupled-運転 rarity
  'キハ201': { lines: ['jp-北海道旅客鉄道-函館線', 'jp-北海道旅客鉄道-千歳線'] },
  // ja.wikipedia.org/wiki/国鉄キハ54形気動車; mynavi.jp 2026-06-10 on 花咲線 summer 2026 augmented service using キハ54/キハ40
  'キハ54': { lines: ['jp-北海道旅客鉄道-根室線', 'jp-四国旅客鉄道-予土線', 'jp-四国旅客鉄道-予讃線', 'jp-四国旅客鉄道-内子線'] },
  // ja.wikipedia.org/wiki/JR東日本HB-E210系気動車 + 4gousya.net 配置歴
  'HBE210': { lines: ['jp-東日本旅客鉄道-石巻線', 'jp-東日本旅客鉄道-仙石線', 'jp-東日本旅客鉄道-東北線'] },
  // ja.wikipedia.org/wiki/JR東日本HB-E220系気動車 + JR東日本プレスリリース(2024年11月21日) + train-times.net(2026年3月14日 盛岡支社ダイヤ改正)
  'HBE220': { lines: ['jp-東日本旅客鉄道-八高線', 'jp-東日本旅客鉄道-釜石線', 'jp-東日本旅客鉄道-東北線'] },
  // ja.wikipedia.org/wiki/JR東日本キハ100系・キハ110系気動車 + train-fan.com/大船渡線キハ100置換記事
  'キハ100': { lines: ['jp-東日本旅客鉄道-北上線', 'jp-東日本旅客鉄道-大船渡線', 'jp-東日本旅客鉄道-釜石線'] },
  // ja.wikipedia.org/JR東海キハ25形気動車; railway.jr-central.co.jp/train/local/detail_03_10/ (運用線区: 高山線・太多線・紀勢線・参宮線, 代走で名松線)
  'キハ25': { lines: ['jp-東海旅客鉄道-高山線', 'jp-東海旅客鉄道-太多線', 'jp-東海旅客鉄道-紀勢線', 'jp-東海旅客鉄道-参宮線', 'jp-東海旅客鉄道-名松線'] },
  // ja.wikipedia.org/JR東海キハ75形気動車; railway.jr-central.co.jp/train/local/detail_03_07/; railf.jp/news/2024/10/27 (transfer/expansion onto 高山線)
  'キハ75': { lines: ['jp-東海旅客鉄道-紀勢線', 'jp-東海旅客鉄道-参宮線', 'jp-東海旅客鉄道-関西線', 'jp-東海旅客鉄道-高山線', 'jp-東海旅客鉄道-太多線'] },
  // ja.wikipedia.org/wiki/JR西日本キハ120形気動車; uraken.net kiha120 — confirmed sole single-car DMU across ~10 JR西日本 local non-electrified lines, no retirement p
  'キハ120': { lines: ['jp-西日本旅客鉄道-木次線', 'jp-西日本旅客鉄道-因美線', 'jp-西日本旅客鉄道-姫新線', 'jp-西日本旅客鉄道-芸備線', 'jp-西日本旅客鉄道-山陰線', 'jp-西日本旅客鉄道-津山線', 'jp-西日本旅客鉄道-美祢線', 'jp-西日本旅客鉄道-高山線', 'jp-西日本旅客鉄道-越美北線', 'jp-西日本旅客鉄道-小浜線'] },
  // ja.wikipedia.org/wiki/JR西日本キハ126系気動車; pahoo.org img20130829-152146 — confirmed 100km/h service max (130km/h-capable design) on 米子～鳥取～益田 corridor plus 
  'キハ126': { lines: ['jp-西日本旅客鉄道-山陰線', 'jp-西日本旅客鉄道-因美線', 'jp-西日本旅客鉄道-境線'] },
  // ja.wikipedia.org/wiki/国鉄キハ32形気動車; shikoku-railway-note.com 2026 — 11 cars remain, all Matsuyama-based, running 予土線/内子線/予讃線 local services after Kochi-
  'キハ32': { lines: ['jp-四国旅客鉄道-予土線', 'jp-四国旅客鉄道-内子線', 'jp-四国旅客鉄道-予讃線'] },
  // ja.wikipedia.org/wiki/JR九州YC1系気動車; tetsudo.com 2025 — debuted March 2020 on 佐世保線/大村線/長崎線 as JR九州's first diesel-electric hybrid; expanded July 2025 to
  'YC1': { lines: ['jp-九州旅客鉄道-佐世保線', 'jp-九州旅客鉄道-大村線', 'jp-九州旅客鉄道-長崎線'] },
  // ja.wikipedia.org/wiki/JR九州キハ200系気動車 — debuted 1991 with a then-advanced 331kW engine and claw-clutch transmission; currently covers all of 久大本線 and 豊肥
  'キハ200': { lines: ['jp-九州旅客鉄道-久大線', 'jp-九州旅客鉄道-豊肥線', 'jp-九州旅客鉄道-指宿枕崎線'] },
  // ja.wikipedia 肥薩おれんじ鉄道HSOR-100形気動車; ja.wikipedia おれんじ食堂
  'HSOR100': { lines: ['jp-肥薩おれんじ鉄道-肥薩おれんじ鉄道線'] },
  // 1000形と1200形を1枚に統合：1200形は1000形56両中18両の1500形併結対応改造車（2006/2008年、原番号+200）で同一機関・台枠・110km/h、ja.wikipediaの1200形記事は1000形記事へのリダイレクト。1500形は別世代につき別カード。土讃線は高知配置10
  '四国1000': { lines: ['jp-四国旅客鉄道-高徳線', 'jp-四国旅客鉄道-徳島線', 'jp-四国旅客鉄道-土讃線', 'jp-四国旅客鉄道-牟岐線', 'jp-四国旅客鉄道-鳴門線'] },
  // 2006〜2014年新製34両・徳島配置の最新一般気動車（コモンレール450PS・低床、旧国鉄形と併結不可でこれが1200形改造の理由）。ja.wikipediaで独立記事を持つ別世代につき単独カード。設計最高120km/h・営業最高110km/h (ja.wikipedia 1500形; jr-s
  '四国1500': { lines: ['jp-四国旅客鉄道-高徳線', 'jp-四国旅客鉄道-徳島線', 'jp-四国旅客鉄道-牟岐線', 'jp-四国旅客鉄道-鳴門線', 'jp-四国旅客鉄道-土讃線'] },
};

// ── init-time inversion: lineId → ordered fold list ─────────────────────────
// LINE_PROFILES entries come first (curated order = pad order); model-major entries
// append in MODEL_SERVICE_LINES declaration order (registry order: 特急 → 通勤 → 気動車).

const profileByLine = new Map<string, string[]>();
// Per-line membership Sets keep insertion O(1) as the dataset graduates past the
// curated scale (review finding: includes() scans go quadratic with roster growth).
const foldSeenByLine = new Map<string, Set<string>>();
for (const [lineId, folds] of Object.entries(LINE_PROFILES)) {
  profileByLine.set(lineId, [...folds]);
  foldSeenByLine.set(lineId, new Set(folds));
}
for (const [fold, entry] of Object.entries(MODEL_SERVICE_LINES)) {
  for (const lineId of entry.lines) {
    const seen = foldSeenByLine.get(lineId);
    if (seen === undefined) {
      profileByLine.set(lineId, [fold]);
      foldSeenByLine.set(lineId, new Set([fold]));
    } else if (!seen.has(fold)) {
      seen.add(fold);
      profileByLine.get(lineId)!.push(fold);
    }
  }
}

const ubiquitousFolds = new Set<string>(
  Object.entries(MODEL_SERVICE_LINES)
    .filter(([, e]) => e.ubiquitous === true)
    .map(([fold]) => fold),
);

/** Ordered fold list a rider can actually board on `lineId`, or undefined when the
 *  line has no curated profile (suggestion layer then shows no default pads). */
export function lineProfile(lineId: string | undefined): readonly string[] | undefined {
  return lineId === undefined ? undefined : profileByLine.get(lineId);
}

/** Nationwide-workhorse flag (キハ40 class): eligible as a recent on any conventional
 *  line of its country even where not a curated pad. */
export function isUbiquitousFold(fold: string): boolean {
  return ubiquitousFolds.has(fold);
}

/** All profiled lineIds (test + debug surface). */
export function profiledLineIds(): string[] {
  return [...profileByLine.keys()];
}
