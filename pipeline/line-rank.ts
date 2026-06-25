export type RailLineRank = 0 | 1 | 2 | 3 | 4;

export interface RailLineRankInput {
  operator?: string;
  name: string;
  isHSR: boolean;
  stationCount: number;
  km: number;
}

const rankKey = (operator: string | undefined, name: string): string => `${operator ?? ''}\u0000${name}`;

// First-match override table for known marquee lines where the heuristic tier would be
// misleading in the N02 package's operator/name vocabulary.
export const LINE_RANK_OVERRIDES = new Map<string, RailLineRank>([
  [rankKey('東日本旅客鉄道', '山手線'), 2],
  [rankKey('西日本旅客鉄道', '大阪環状線'), 2],
  [rankKey('東日本旅客鉄道', '中央線'), 2],
  [rankKey('東日本旅客鉄道', '京葉線'), 2],
  [rankKey('東日本旅客鉄道', '南武線'), 2],
  [rankKey('東日本旅客鉄道', '根岸線'), 2],
  [rankKey('東日本旅客鉄道', '横浜線'), 2],
  [rankKey('東日本旅客鉄道', '武蔵野線'), 2],
  [rankKey('東日本旅客鉄道', '青梅線'), 2],
  [rankKey('東日本旅客鉄道', '赤羽線'), 2],
  [rankKey('西日本旅客鉄道', 'JR東西線'), 2],
  [rankKey('西日本旅客鉄道', 'おおさか東線'), 2],
  [rankKey('西日本旅客鉄道', '桜島線'), 2],
  [rankKey('東京都', '荒川線'), 4],
]);

const JR_TRUNK_NAMES = new Set([
  '東海道線',
  '山陽線',
  '東北線',
  '鹿児島線',
  '中央線',
  '函館線',
  '日豊線',
  '長崎線',
  '関西線',
  '信越線',
  '北陸線',
  '奥羽線',
  '羽越線',
  '室蘭線',
  '常磐線',
  '横須賀線',
  '高崎線',
]);

const MAJOR_PRIVATE_OPERATORS = new Set([
  '京王電鉄',
  '京成電鉄',
  '京浜急行電鉄',
  '近畿日本鉄道',
  '小田急電鉄',
  '西武鉄道',
  '東武鉄道',
  '相模鉄道',
  '東急電鉄',
  '南海電気鉄道',
  '京阪電気鉄道',
  '阪急電鉄',
  '阪神電気鉄道',
  '名古屋鉄道',
  '西日本鉄道',
]);

const MAJOR_PRIVATE_TRUNKS = new Set([
  rankKey('近畿日本鉄道', '大阪線'),
  rankKey('近畿日本鉄道', '名古屋線'),
  rankKey('近畿日本鉄道', '奈良線'),
  rankKey('名古屋鉄道', '名古屋本線'),
  rankKey('小田急電鉄', '小田原線'),
  rankKey('東武鉄道', '伊勢崎線'),
  rankKey('東武鉄道', '日光線'),
  rankKey('東武鉄道', '東上本線'),
  rankKey('京浜急行電鉄', '本線'),
  rankKey('京成電鉄', '本線'),
  rankKey('南海電気鉄道', '南海本線'),
  rankKey('南海電気鉄道', '高野線'),
  rankKey('西日本鉄道', '天神大牟田線'),
  rankKey('阪急電鉄', '神戸線'),
  rankKey('阪急電鉄', '神戸本線'),
  rankKey('阪急電鉄', '宝塚線'),
  rankKey('阪急電鉄', '宝塚本線'),
  rankKey('阪急電鉄', '京都線'),
  rankKey('阪急電鉄', '京都本線'),
  rankKey('阪神電気鉄道', '本線'),
  rankKey('京阪電気鉄道', '京阪本線'),
  rankKey('京阪電気鉄道', '本線'),
]);

const TRAM_OPERATORS = new Set([
  '広島電鉄',
  '長崎電気軌道',
  '岡山電気軌道',
  '阪堺電気軌道',
  '万葉線',
  '熊本市',
  '鹿児島市',
  '函館市',
  '一般社団法人札幌市交通事業振興公社',
]);

const TRAM_LINES = new Set([
  rankKey('東京都', '荒川線'),
  rankKey('豊橋鉄道', '東田本線'),
  rankKey('とさでん交通', '伊野線'),
  rankKey('とさでん交通', '後免線'),
  rankKey('とさでん交通', '桟橋線'),
]);

const MUNICIPAL_SUBWAY_OPERATORS = new Set([
  '東京都',
  '札幌市',
  '仙台市',
  '横浜市',
  '名古屋市',
  '京都市',
  '神戸市',
  '福岡市',
]);

const EXTRA_URBAN_OPERATORS = new Set([
  '北九州高速鉄道',
]);

const MINOR_NAME_RE = /鋼索|ケーブル|索道|登山/;
const TRAM_OPERATOR_RE = /軌道|電気軌道/;
const URBAN_OPERATOR_RE = /地下鉄|市営|高速電気軌道|都市モノレール|モノレール|新交通|ライトレール/;
const DENSE_JR_STATIONS_PER_KM = 0.55;

function isJrOperator(operator: string | undefined): boolean {
  return !!operator && operator.endsWith('旅客鉄道');
}

function isJrTrunk(operator: string | undefined, name: string): boolean {
  return isJrOperator(operator) && (name.endsWith('本線') || JR_TRUNK_NAMES.has(name));
}

function isMajorPrivateTrunk(operator: string | undefined, name: string): boolean {
  return MAJOR_PRIVATE_TRUNKS.has(rankKey(operator, name));
}

function isTram(operator: string | undefined, name: string): boolean {
  return TRAM_OPERATOR_RE.test(operator ?? '')
    || TRAM_OPERATORS.has(operator ?? '')
    || TRAM_LINES.has(rankKey(operator, name));
}

function isUrbanOperator(operator: string | undefined): boolean {
  return URBAN_OPERATOR_RE.test(operator ?? '')
    || MUNICIPAL_SUBWAY_OPERATORS.has(operator ?? '')
    || EXTRA_URBAN_OPERATORS.has(operator ?? '');
}

function isPrivateOrThirdSector(operator: string | undefined): boolean {
  if (!operator || isJrOperator(operator)) return false;
  if (MUNICIPAL_SUBWAY_OPERATORS.has(operator) || TRAM_OPERATORS.has(operator)) return false;
  return true;
}

function isDenseJr(input: RailLineRankInput): boolean {
  if (!isJrOperator(input.operator) || input.km <= 0) return false;
  return input.stationCount / input.km >= DENSE_JR_STATIONS_PER_KM;
}

export function assignRailLineRank(input: RailLineRankInput): RailLineRank {
  const operator = input.operator ?? '';
  const { name } = input;
  if (input.isHSR) return 0;

  const override = LINE_RANK_OVERRIDES.get(rankKey(operator, name));
  if (override !== undefined) return override;

  if (isJrTrunk(operator, name) || isMajorPrivateTrunk(operator, name)) return 1;

  if (
    isTram(operator, name)
    || MINOR_NAME_RE.test(name)
    || (input.stationCount < 5 && isPrivateOrThirdSector(operator))
  ) return 4;

  if (
    isUrbanOperator(operator)
    || MAJOR_PRIVATE_OPERATORS.has(operator)
    || isDenseJr(input)
  ) return 2;

  return 3;
}

export function rankHistogram(lines: { rank?: RailLineRank }[]): Record<RailLineRank, number> {
  return {
    0: lines.filter((line) => line.rank === 0).length,
    1: lines.filter((line) => line.rank === 1).length,
    2: lines.filter((line) => line.rank === 2).length,
    3: lines.filter((line) => line.rank === 3).length,
    4: lines.filter((line) => line.rank === 4).length,
  };
}
