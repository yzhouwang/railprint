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
//  • Fold tokens MUST resolve in the model registry (fold or alias) — test-enforced.
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
};

/** Model-major service lines for conventional 特急・通勤・気動車 registry models
 *  (fact-checked 2026-07-10; inverted into line profiles at module init). A model
 *  appears in a line's chip pads iff that line is listed here or in LINE_PROFILES.
 *  `ubiquitous` = nationwide workhorse family; its listed lines are only the iconic
 *  ones, and the suggestion gate additionally lets it pass as a RECENT on any
 *  conventional line of its country (never as a pad beyond the listed lines). */
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
};

// ── init-time inversion: lineId → ordered fold list ─────────────────────────
// LINE_PROFILES entries come first (curated order = pad order); model-major entries
// append in MODEL_SERVICE_LINES declaration order (registry order: 特急 → 通勤 → 気動車).

const profileByLine = new Map<string, string[]>();
for (const [lineId, folds] of Object.entries(LINE_PROFILES)) {
  profileByLine.set(lineId, [...folds]);
}
for (const [fold, entry] of Object.entries(MODEL_SERVICE_LINES)) {
  for (const lineId of entry.lines) {
    const list = profileByLine.get(lineId);
    if (list === undefined) profileByLine.set(lineId, [fold]);
    else if (!list.includes(fold)) list.push(fold);
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
