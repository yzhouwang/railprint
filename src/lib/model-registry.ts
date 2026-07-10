// 車両 model registry (v0.13 車両図鑑, plan D2/D3) — hand-curated REFERENCE DATA, facts only.
// PURE DATA MODULE: imports nothing (train-models.ts builds every derived index — alias map,
// speed table, roster counts — so no import cycle can form). Grows to a content-addressed
// rail/registry.json artifact later (Wikidata SPARQL + overrides, TODOS.md) — this shape is
// designed to graduate unchanged.
//
// Identity rules (D2, review-locked):
//  • `id` is OPERATOR-SCOPED (`jp-jre-e5`) — folds collide across operators once the roster
//    leaves HSR (東急5000 vs 京王5000), ids never do.
//  • `fold` is the canonical comparison key (canonicalizeTrainModel output) — an ALIAS-INDEX
//    lookup, never the identity. The v0.13 roster MUST be fold-collision-free (test-enforced),
//    so every raw string maps to at most one card without line/operator context.
//  • E5/H5 and E7/W7 are separate cards linked by pairId (review 10A). Denominator = 13
//    after the 2026-07 fact-check restored E2 (2026-03 改正で定期運用回復).
//  • `active` gates the roster DENOMINATOR only: inactive entries (E3) never ghost-card or
//    count in X/N, but still match rides and render as collected history.
//  • `corridor: 'jinghu'` marks the CN corridor roster (review 11B) — the CN meter counts ONLY
//    corridor models (earnable from the app's own data surface), never all-China.
//  • `accentColor` is a stylized LIVERY approximation — permitted ONLY inside silhouette fills
//    (design DD8 livery-is-data carve-out); all chrome stays emerald-system.
//
// Provenance (14A): every entry carries `source` — a fact-source note cross-checked against
// Wikipedia/Wikidata at curation time. Roster reviewed at each data sync (ロースター基準: 2026).

export type TrainCategory = 'shinkansen' | 'cn-hsr' | 'ltd-express' | 'commuter' | 'dmu';

export type SilhouetteVariant = 'shinkansen' | 'cn-hsr' | 'express' | 'commuter' | 'dmu';

export interface TrainModelInfo {
  /** Operator-scoped stable id — the identity users' collections key on. */
  id: string;
  /** Canonical fold key (= canonicalizeTrainModel(name)); unique across the registry. */
  fold: string;
  /** 形式 display name. */
  name: string;
  nameRomaji?: string;
  country: 'JP' | 'CN';
  category: TrainCategory;
  operator: string;
  /** Top service speed; omitted when not confidently known (unknowns never fake facts). */
  topSpeedKmh?: number;
  /** 愛称 this 形式 serves (D13: display resolves to candidate SETS, never auto-pick). */
  nicknames?: string[];
  /** Extra raw spellings that resolve to this entry (compared via foldKey). */
  aliases?: string[];
  /** Same-design different-operator sibling (E5↔H5, E7↔W7). */
  pairId?: string;
  debutYear?: number;
  /** In the roster denominator (shinkansen / corridor meters). */
  active: boolean;
  /** Honest urgency, facts only ('2027年1月引退予定') — never invented rarity. */
  retiresNote?: string;
  /** Stylized livery fill (DD8: silhouette fills ONLY). */
  accentColor?: string;
  silhouette: SilhouetteVariant;
  /** CN corridor roster membership (11B). */
  corridor?: 'jinghu';
  /** Provenance note (14A). */
  source: string;
}

export const ROSTER_BASIS_YEAR = 2026;

export const CATEGORY_LABELS: Record<TrainCategory, string> = {
  shinkansen: '新幹線',
  'cn-hsr': '中国高速鉄道',
  'ltd-express': '特急',
  commuter: '通勤・近郊',
  dmu: '気動車',
};

export const MODEL_REGISTRY: TrainModelInfo[] = [
  // ──────────────────── 新幹線 (active roster = 13 — fact-check 2026-07) ────────────────────
  { id: 'jp-jrc-n700s', fold: 'N700S', name: 'N700S', nameRomaji: 'N700S', country: 'JP', category: 'shinkansen', operator: 'JR東海', topSpeedKmh: 300, nicknames: ['のぞみ', 'ひかり', 'こだま'], debutYear: 2020, active: true, accentColor: '#1E50A2', silhouette: 'shinkansen', source: '東海道285/山陽300km/h — 最高運転速度は300 (ja.wikipedia N700S系; fact-check 2026-07)' },
  { id: 'jp-jrc-n700a', fold: 'N700A', name: 'N700A', country: 'JP', category: 'shinkansen', operator: 'JR東海', topSpeedKmh: 300, nicknames: ['のぞみ', 'ひかり', 'こだま'], debutYear: 2013, active: true, accentColor: '#2A5CAA', silhouette: 'shinkansen', source: '東海道・山陽新幹線 (ja.wikipedia N700系)' },
  { id: 'jp-jrw-n700', fold: 'N700', name: 'N700系', country: 'JP', category: 'shinkansen', operator: 'JR西日本・JR九州', topSpeedKmh: 300, nicknames: ['みずほ', 'さくら', 'こだま'], aliases: ['N700系7000番台', 'N700系8000番台'], debutYear: 2011, active: true, accentColor: '#3A6EA5', silhouette: 'shinkansen', source: '山陽・九州直通用 7000/8000番台が現役 (ja.wikipedia N700系7000・8000番台)' },
  { id: 'jp-jrw-500', fold: '500', name: '500系', country: 'JP', category: 'shinkansen', operator: 'JR西日本', topSpeedKmh: 285, nicknames: ['こだま'], debutYear: 1997, active: true, retiresNote: '2027年1月引退予定', accentColor: '#7A8FA6', silhouette: 'shinkansen', source: '山陽こだま運用、2027年初引退発表 (JR西日本プレス 2024)' },
  { id: 'jp-jrw-700', fold: '700', name: '700系', country: 'JP', category: 'shinkansen', operator: 'JR西日本', topSpeedKmh: 285, nicknames: ['こだま', 'ひかりレールスター'], aliases: ['700系7000番台', 'レールスター'], debutYear: 1999, active: true, accentColor: '#4E5B66', silhouette: 'shinkansen', source: '山陽 7000番台レールスターが現役 (東海道16両は2020年引退)' },
  { id: 'jp-jrk-800', fold: '800', name: '800系', country: 'JP', category: 'shinkansen', operator: 'JR九州', topSpeedKmh: 260, nicknames: ['つばめ', 'さくら'], debutYear: 2004, active: true, accentColor: '#B02A2A', silhouette: 'shinkansen', source: '九州新幹線 (ja.wikipedia 800系)' },
  { id: 'jp-jre-e5', fold: 'E5', name: 'E5系', nameRomaji: 'E5 Series', country: 'JP', category: 'shinkansen', operator: 'JR東日本', topSpeedKmh: 320, nicknames: ['はやぶさ', 'はやて', 'やまびこ', 'なすの'], pairId: 'jp-jrh-h5', debutYear: 2011, active: true, accentColor: '#00A95F', silhouette: 'shinkansen', source: '東北・北海道新幹線 320km/h (ja.wikipedia E5系・H5系)' },
  { id: 'jp-jrh-h5', fold: 'H5', name: 'H5系', country: 'JP', category: 'shinkansen', operator: 'JR北海道', topSpeedKmh: 320, nicknames: ['はやぶさ', 'はやて'], pairId: 'jp-jre-e5', debutYear: 2016, active: true, accentColor: '#008B62', silhouette: 'shinkansen', source: 'E5系同設計・彩香パープル帯 (ja.wikipedia E5系・H5系)' },
  { id: 'jp-jre-e6', fold: 'E6', name: 'E6系', country: 'JP', category: 'shinkansen', operator: 'JR東日本', topSpeedKmh: 320, nicknames: ['こまち'], debutYear: 2013, active: true, accentColor: '#C8102E', silhouette: 'shinkansen', source: '秋田新幹線 茜色 (ja.wikipedia E6系)' },
  { id: 'jp-jre-e7', fold: 'E7', name: 'E7系', country: 'JP', category: 'shinkansen', operator: 'JR東日本', topSpeedKmh: 260, nicknames: ['かがやき', 'はくたか', 'あさま', 'とき', 'たにがわ'], pairId: 'jp-jrw-w7', debutYear: 2014, active: true, accentColor: '#2A5CAA', silhouette: 'shinkansen', source: '北陸・上越新幹線 空色 (ja.wikipedia E7系・W7系)' },
  { id: 'jp-jrw-w7', fold: 'W7', name: 'W7系', country: 'JP', category: 'shinkansen', operator: 'JR西日本', topSpeedKmh: 260, nicknames: ['かがやき', 'はくたか', 'つるぎ'], pairId: 'jp-jre-e7', debutYear: 2015, active: true, accentColor: '#245089', silhouette: 'shinkansen', source: 'E7系同設計 (ja.wikipedia E7系・W7系)' },
  { id: 'jp-jre-e8', fold: 'E8', name: 'E8系', country: 'JP', category: 'shinkansen', operator: 'JR東日本', topSpeedKmh: 300, nicknames: ['つばさ'], debutYear: 2024, active: true, accentColor: '#7A4A9E', silhouette: 'shinkansen', source: '山形新幹線 2024年営業開始・300km/h (ja.wikipedia E8系)' },
  // ── E2は2026-03改正で定期運用回復（分母入り）・E3は引退済み（分母外・乗車歴は表示） ──
  { id: 'jp-jre-e2', fold: 'E2', name: 'E2系', country: 'JP', category: 'shinkansen', operator: 'JR東日本', topSpeedKmh: 275, nicknames: ['やまびこ', 'なすの', 'とき'], debutYear: 1997, active: true, retiresNote: 'E10系置換見込み（〜2030年頃）', accentColor: '#4A6FA5', silhouette: 'shinkansen', source: '2026-03改正で仙台以北の定期運用が回復・E10系まで継続見込み (tetsudo.com/column/1502; fact-check 2026-07)' },
  { id: 'jp-jre-e3', fold: 'E3', name: 'E3系', country: 'JP', category: 'shinkansen', operator: 'JR東日本', topSpeedKmh: 275, nicknames: ['つばさ'], debutYear: 1997, active: false, retiresNote: '定期運用終了（2025年12月）', accentColor: '#9AA5AE', silhouette: 'shinkansen', source: 'つばさ定期運行は2025-12-24で終了、E8系へ置換完了 (mynavi 2024-12-13; fact-check 2026-07)' },

  // ─────────────── 中国高速鉄道 (corridor='jinghu' = 京沪 meter roster, review 11B) ───────────────
  { id: 'cn-cr-cr400af', fold: 'CR400AF', name: 'CR400AF', country: 'CN', category: 'cn-hsr', operator: '中国国家鉄路集団', topSpeedKmh: 350, nicknames: ['复兴号'], debutYear: 2017, active: true, accentColor: '#C8102E', silhouette: 'cn-hsr', corridor: 'jinghu', source: '京沪高铁 350km/h 営業 (zh.wikipedia 复兴号CR400AF)' },
  { id: 'cn-cr-cr400bf', fold: 'CR400BF', name: 'CR400BF', country: 'CN', category: 'cn-hsr', operator: '中国国家鉄路集団', topSpeedKmh: 350, nicknames: ['复兴号'], debutYear: 2017, active: true, accentColor: '#B08A00', silhouette: 'cn-hsr', corridor: 'jinghu', source: '京沪高铁 350km/h 営業 (zh.wikipedia 复兴号CR400BF)' },
  { id: 'cn-cr-crh380a', fold: 'CRH380A', name: 'CRH380A', country: 'CN', category: 'cn-hsr', operator: '中国国家鉄路集団', topSpeedKmh: 350, nicknames: ['和谐号'], debutYear: 2010, active: true, accentColor: '#9AA0A6', silhouette: 'cn-hsr', source: '京沪開業時の主力だが2025-26年の同線定期運用からは撤退 — corridorタグなし (zh.wikipedia 京沪高速动车组列车; fact-check 2026-07)' },
  { id: 'cn-cr-crh380b', fold: 'CRH380B', name: 'CRH380B', country: 'CN', category: 'cn-hsr', operator: '中国国家鉄路集団', topSpeedKmh: 350, nicknames: ['和谐号'], debutYear: 2011, active: true, accentColor: '#6E7FA0', silhouette: 'cn-hsr', corridor: 'jinghu', source: '京沪高铁の現行和谐号主力 (zh.wikipedia 京沪高速动车组列车; fact-check 2026-07)' },
  { id: 'cn-cr-crh380c', fold: 'CRH380C', name: 'CRH380C', country: 'CN', category: 'cn-hsr', operator: '中国国家鉄路集団', topSpeedKmh: 350, nicknames: ['和谐号'], debutYear: 2013, active: true, accentColor: '#7B8794', silhouette: 'cn-hsr', corridor: 'jinghu', source: 'CRH380CL が京沪高铁で現役 (zh.wikipedia 京沪高速动车组列车; fact-check 2026-07)' },
  { id: 'cn-cr-cr300af', fold: 'CR300AF', name: 'CR300AF', country: 'CN', category: 'cn-hsr', operator: '中国国家鉄路集団', topSpeedKmh: 250, nicknames: ['复兴号'], debutYear: 2020, active: true, accentColor: '#4A7B8C', silhouette: 'cn-hsr', source: '250km/h 复兴号 (zh.wikipedia CR300AF)' },
  { id: 'cn-cr-cr300bf', fold: 'CR300BF', name: 'CR300BF', country: 'CN', category: 'cn-hsr', operator: '中国国家鉄路集団', topSpeedKmh: 250, nicknames: ['复兴号'], debutYear: 2020, active: true, accentColor: '#3F6E7E', silhouette: 'cn-hsr', source: '250km/h 复兴号 (zh.wikipedia CR300BF)' },
  { id: 'cn-cr-cr200j', fold: 'CR200J', name: 'CR200J', country: 'CN', category: 'cn-hsr', operator: '中国国家鉄路集団', topSpeedKmh: 160, nicknames: ['复兴号', '绿巨人'], debutYear: 2019, active: true, accentColor: '#006341', silhouette: 'cn-hsr', source: '160km/h 動力集中式・通称 绿巨人 (zh.wikipedia CR200J)' },
  { id: 'cn-cr-crh2', fold: 'CRH2', name: 'CRH2', country: 'CN', category: 'cn-hsr', operator: '中国国家鉄路集団', topSpeedKmh: 250, nicknames: ['和谐号'], debutYear: 2007, active: true, accentColor: '#5A7FBF', silhouette: 'cn-hsr', source: 'E2系ベースの和谐号 (zh.wikipedia CRH2)' },
  { id: 'cn-cr-crh3', fold: 'CRH3', name: 'CRH3', country: 'CN', category: 'cn-hsr', operator: '中国国家鉄路集団', topSpeedKmh: 350, nicknames: ['和谐号'], debutYear: 2008, active: true, accentColor: '#C0C3C7', silhouette: 'cn-hsr', source: 'Velaroベースの和谐号 (zh.wikipedia CRH3)' },

  // ────────────────────────────── 特急 (オープン式 — 分母なし) ──────────────────────────────
  { id: 'jp-jrw-285', fold: '285', name: '285系', country: 'JP', category: 'ltd-express', operator: 'JR西日本・JR東海', topSpeedKmh: 130, nicknames: ['サンライズ出雲', 'サンライズ瀬戸'], debutYear: 1998, active: true, accentColor: '#B8A05A', silhouette: 'express', source: '現存唯一の定期寝台特急 (ja.wikipedia 285系; fact-check 2026-07)' },
  { id: 'jp-jre-e353', fold: 'E353', name: 'E353系', country: 'JP', category: 'ltd-express', operator: 'JR東日本', topSpeedKmh: 130, nicknames: ['あずさ', 'かいじ'], debutYear: 2017, active: true, accentColor: '#6C4CA0', silhouette: 'express', source: '中央線特急 (ja.wikipedia E353系)' },
  { id: 'jp-jre-e259', fold: 'E259', name: 'E259系', country: 'JP', category: 'ltd-express', operator: 'JR東日本', topSpeedKmh: 130, nicknames: ['成田エクスプレス'], debutYear: 2009, active: true, accentColor: '#C22C35', silhouette: 'express', source: 'N’EX (ja.wikipedia E259系)' },
  { id: 'jp-jre-e657', fold: 'E657', name: 'E657系', country: 'JP', category: 'ltd-express', operator: 'JR東日本', topSpeedKmh: 130, nicknames: ['ひたち', 'ときわ'], debutYear: 2012, active: true, accentColor: '#C8384A', silhouette: 'express', source: '常磐線特急 (ja.wikipedia E657系)' },
  { id: 'jp-jre-e261', fold: 'E261', name: 'E261系', country: 'JP', category: 'ltd-express', operator: 'JR東日本', topSpeedKmh: 120, nicknames: ['サフィール踊り子'], debutYear: 2020, active: true, accentColor: '#274C77', silhouette: 'express', source: 'サフィール踊り子 (ja.wikipedia E261系)' },
  { id: 'jp-jre-e653', fold: 'E653', name: 'E653系', country: 'JP', category: 'ltd-express', operator: 'JR東日本', topSpeedKmh: 130, nicknames: ['しらゆき', 'いなほ'], debutYear: 1997, active: true, accentColor: '#D2691E', silhouette: 'express', source: '羽越・信越特急 (ja.wikipedia E653系)' },
  { id: 'jp-jrc-383', fold: '383', name: '383系', country: 'JP', category: 'ltd-express', operator: 'JR東海', topSpeedKmh: 130, nicknames: ['しなの'], debutYear: 1995, active: true, accentColor: '#4C6B8A', silhouette: 'express', source: '振子式しなの (ja.wikipedia 383系)' },
  { id: 'jp-jrc-hc85', fold: 'HC85', name: 'HC85系', country: 'JP', category: 'ltd-express', operator: 'JR東海', topSpeedKmh: 120, nicknames: ['ひだ', '南紀'], debutYear: 2022, active: true, accentColor: '#B4482B', silhouette: 'dmu', source: 'ハイブリッド特急 (ja.wikipedia HC85系)' },
  { id: 'jp-jrw-683', fold: '683', name: '683系', country: 'JP', category: 'ltd-express', operator: 'JR西日本', topSpeedKmh: 130, nicknames: ['サンダーバード', 'しらさぎ'], debutYear: 2001, active: true, accentColor: '#3B5EA8', silhouette: 'express', source: '北陸特急 (ja.wikipedia 683系)' },
  { id: 'jp-jrw-289', fold: '289', name: '289系', country: 'JP', category: 'ltd-express', operator: 'JR西日本', topSpeedKmh: 130, nicknames: ['こうのとり', 'くろしお'], debutYear: 2015, active: true, accentColor: '#5A7B9C', silhouette: 'express', source: '683系改造の直流特急 (ja.wikipedia 289系)' },
  { id: 'jp-jrw-287', fold: '287', name: '287系', country: 'JP', category: 'ltd-express', operator: 'JR西日本', topSpeedKmh: 130, nicknames: ['こうのとり', 'きのさき', 'くろしお'], debutYear: 2011, active: true, accentColor: '#8A9BAA', silhouette: 'express', source: '北近畿・紀勢特急 (ja.wikipedia 287系)' },
  { id: 'jp-jrw-273', fold: '273', name: '273系', country: 'JP', category: 'ltd-express', operator: 'JR西日本', topSpeedKmh: 120, nicknames: ['やくも'], debutYear: 2024, active: true, accentColor: '#9A6A3C', silhouette: 'express', source: '新型やくも ブロンズ (ja.wikipedia 273系)' },
  { id: 'jp-jrw-271', fold: '271', name: '271系', country: 'JP', category: 'ltd-express', operator: 'JR西日本', topSpeedKmh: 130, nicknames: ['はるか'], debutYear: 2020, active: true, accentColor: '#3E7CB1', silhouette: 'express', source: 'はるか増結用 (ja.wikipedia 271系)' },
  { id: 'jp-jrw-283', fold: '283', name: '283系', country: 'JP', category: 'ltd-express', operator: 'JR西日本', topSpeedKmh: 130, nicknames: ['くろしお'], debutYear: 1996, active: true, accentColor: '#2E86AB', silhouette: 'express', source: 'オーシャンアロー (ja.wikipedia 283系)' },
  { id: 'jp-jrk-787', fold: '787', name: '787系', country: 'JP', category: 'ltd-express', operator: 'JR九州', topSpeedKmh: 130, nicknames: ['リレーかもめ', 'きらめき', '36ぷらす3'], debutYear: 1992, active: true, accentColor: '#3E3A39', silhouette: 'express', source: '水戸岡デザインのメタリック特急 (ja.wikipedia 787系)' },
  { id: 'jp-jrk-883', fold: '883', name: '883系', country: 'JP', category: 'ltd-express', operator: 'JR九州', topSpeedKmh: 130, nicknames: ['ソニック'], debutYear: 1995, active: true, accentColor: '#1E4FA0', silhouette: 'express', source: '振子式ソニック (ja.wikipedia 883系)' },
  { id: 'jp-jrk-885', fold: '885', name: '885系', country: 'JP', category: 'ltd-express', operator: 'JR九州', topSpeedKmh: 130, nicknames: ['かもめ', 'ソニック'], debutYear: 2000, active: true, accentColor: '#A9AAAB', silhouette: 'express', source: '白いかもめ/ソニック (ja.wikipedia 885系)' },
  { id: 'jp-jrh-789', fold: '789', name: '789系', country: 'JP', category: 'ltd-express', operator: 'JR北海道', topSpeedKmh: 120, nicknames: ['ライラック', 'カムイ', 'すずらん'], debutYear: 2002, active: true, accentColor: '#33A3DC', silhouette: 'express', source: '道央特急 (ja.wikipedia 789系)' },
  { id: 'jp-jrh-kiha261', fold: 'キハ261', name: 'キハ261系', country: 'JP', category: 'ltd-express', operator: 'JR北海道', topSpeedKmh: 120, nicknames: ['北斗', 'おおぞら', 'とかち', '宗谷'], debutYear: 2000, active: true, accentColor: '#2456A6', silhouette: 'dmu', source: '道内主力の特急気動車 (ja.wikipedia キハ261系)' },
  { id: 'jp-jrs-8600', fold: '8600', name: '8600系', country: 'JP', category: 'ltd-express', operator: 'JR四国', topSpeedKmh: 130, nicknames: ['しおかぜ', 'いしづち'], debutYear: 2014, active: true, accentColor: '#B8452B', silhouette: 'express', source: '予讃線特急 (ja.wikipedia 8600系)' },
  { id: 'jp-jrs-2700', fold: '2700', name: '2700系', country: 'JP', category: 'ltd-express', operator: 'JR四国', topSpeedKmh: 120, nicknames: ['南風', 'うずしお', 'しまんと'], debutYear: 2019, active: true, accentColor: '#C03A2B', silhouette: 'dmu', source: '振子式特急気動車 (ja.wikipedia 2700系)' },
  { id: 'jp-kintetsu-80000', fold: '80000', name: '80000系', country: 'JP', category: 'ltd-express', operator: '近畿日本鉄道', topSpeedKmh: 130, nicknames: ['ひのとり'], debutYear: 2020, active: true, accentColor: '#7A1E2B', silhouette: 'express', source: '名阪特急ひのとり (ja.wikipedia 近鉄80000系)' },
  { id: 'jp-kintetsu-50000', fold: '50000', name: '50000系', country: 'JP', category: 'ltd-express', operator: '近畿日本鉄道', topSpeedKmh: 130, nicknames: ['しまかぜ'], debutYear: 2013, active: true, accentColor: '#2A4B9B', silhouette: 'express', source: '観光特急しまかぜ (ja.wikipedia 近鉄50000系)' },
  { id: 'jp-nankai-50000', fold: '南海50000', name: '南海50000系', country: 'JP', category: 'ltd-express', operator: '南海電気鉄道', topSpeedKmh: 120, nicknames: ['ラピート'], debutYear: 1994, active: true, accentColor: '#24406B', silhouette: 'express', source: '関空特急ラピート — 素の「50000」foldは近鉄しまかぜが持つため事業者名付き表記が正名（D2 fold衝突回避の実例）(ja.wikipedia 南海50000系)' },
  { id: 'jp-keisei-ae', fold: 'AE', name: 'AE形', country: 'JP', category: 'ltd-express', operator: '京成電鉄', topSpeedKmh: 160, nicknames: ['スカイライナー'], debutYear: 2010, active: true, accentColor: '#2456A6', silhouette: 'express', source: '在来線最速160km/h (ja.wikipedia 京成AE形)' },
  { id: 'jp-tobu-n100', fold: 'N100', name: 'N100系', country: 'JP', category: 'ltd-express', operator: '東武鉄道', topSpeedKmh: 120, nicknames: ['スペーシアX'], debutYear: 2023, active: true, accentColor: '#C9C4B6', silhouette: 'express', source: 'スペーシアX (ja.wikipedia 東武N100系)' },
  { id: 'jp-seibu-001', fold: '001', name: '001系', country: 'JP', category: 'ltd-express', operator: '西武鉄道', topSpeedKmh: 105, nicknames: ['Laview'], debutYear: 2019, active: true, accentColor: '#B7BEC6', silhouette: 'express', source: 'Laview (ja.wikipedia 西武001系)' },
  { id: 'jp-odakyu-70000', fold: '70000', name: '70000形', country: 'JP', category: 'ltd-express', operator: '小田急電鉄', topSpeedKmh: 110, nicknames: ['GSE', 'はこね'], debutYear: 2018, active: true, accentColor: '#C0453E', silhouette: 'express', source: 'ロマンスカーGSE (ja.wikipedia 小田急70000形)' },
  { id: 'jp-meitetsu-2000', fold: '2000', name: '2000系', country: 'JP', category: 'ltd-express', operator: '名古屋鉄道', topSpeedKmh: 120, nicknames: ['ミュースカイ'], debutYear: 2004, active: true, accentColor: '#2C5F9E', silhouette: 'express', source: '中部空港特急ミュースカイ (ja.wikipedia 名鉄2000系)' },

  // ───────────────────────────── 通勤・近郊 (オープン式) ─────────────────────────────
  { id: 'jp-jre-e235', fold: 'E235', name: 'E235系', country: 'JP', category: 'commuter', operator: 'JR東日本', nicknames: ['山手線'], debutYear: 2015, active: true, accentColor: '#9ACD32', silhouette: 'commuter', source: '山手線・横須賀総武快速 (ja.wikipedia E235系)' },
  { id: 'jp-jre-e233', fold: 'E233', name: 'E233系', country: 'JP', category: 'commuter', operator: 'JR東日本', debutYear: 2006, active: true, accentColor: '#F68B1E', silhouette: 'commuter', source: '首都圏主力通勤形 (ja.wikipedia E233系)' },
  { id: 'jp-jre-e231', fold: 'E231', name: 'E231系', country: 'JP', category: 'commuter', operator: 'JR東日本', debutYear: 2000, active: true, accentColor: '#F8B500', silhouette: 'commuter', source: '首都圏通勤・近郊形 (ja.wikipedia E231系)' },
  { id: 'jp-jrw-323', fold: '323', name: '323系', country: 'JP', category: 'commuter', operator: 'JR西日本', nicknames: ['大阪環状線'], debutYear: 2016, active: true, accentColor: '#F39700', silhouette: 'commuter', source: '大阪環状線 (ja.wikipedia 323系)' },
  { id: 'jp-jrc-313', fold: '313', name: '313系', country: 'JP', category: 'commuter', operator: 'JR東海', debutYear: 1999, active: true, accentColor: '#F77321', silhouette: 'commuter', source: '東海圏近郊形 (ja.wikipedia 313系)' },
  { id: 'jp-jrw-227', fold: '227', name: '227系', country: 'JP', category: 'commuter', operator: 'JR西日本', nicknames: ['Red Wing'], debutYear: 2015, active: true, accentColor: '#E60012', silhouette: 'commuter', source: '広島・和歌山地区 (ja.wikipedia 227系)' },

  // ─────────────────────────────── 気動車 (オープン式) ───────────────────────────────
  { id: 'jp-jr-kiha40', fold: 'キハ40', name: 'キハ40系', country: 'JP', category: 'dmu', operator: 'JR各社', debutYear: 1977, active: true, retiresNote: '各地で置換・引退進行中', accentColor: '#D86018', silhouette: 'dmu', source: '国鉄形一般気動車・タラコ色 (ja.wikipedia キハ40系)' },
  { id: 'jp-jre-kihae130', fold: 'キハE130', name: 'キハE130系', country: 'JP', category: 'dmu', operator: 'JR東日本', debutYear: 2007, active: true, accentColor: '#3E92CC', silhouette: 'dmu', source: '水郡線ほか (ja.wikipedia キハE130系)' },
  { id: 'jp-jre-gve400', fold: 'GVE400', name: 'GV-E400系', country: 'JP', category: 'dmu', operator: 'JR東日本', debutYear: 2019, active: true, accentColor: '#8B9DA8', silhouette: 'dmu', source: '電気式気動車 — ハイフン表記はfoldが吸収 (ja.wikipedia GV-E400系)' },
  { id: 'jp-jre-kiha110', fold: 'キハ110', name: 'キハ110系', country: 'JP', category: 'dmu', operator: 'JR東日本', debutYear: 1990, active: true, accentColor: '#2E8B57', silhouette: 'dmu', source: 'ローカル線主力気動車 (ja.wikipedia キハ110系)' },
];
