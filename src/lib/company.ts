// Railway-company display labels. The package ships the formal N02 operator name
// (e.g. 東日本旅客鉄道); riders want the short brand (JR東日本, 東急, 大阪メトロ). This maps the
// long/formal names to short JP labels and de-dupes the company when the line name
// already leads with the brand (so we never show "東急 東急東横線"). All-Japanese (v1).

/** Formal N02 operator → short display label. Mirrors the pipeline's brand prefixes. */
const COMPANY_LABELS: Record<string, string> = {
  // JR group (long formal → JRxx)
  東日本旅客鉄道: 'JR東日本',
  西日本旅客鉄道: 'JR西日本',
  東海旅客鉄道: 'JR東海',
  九州旅客鉄道: 'JR九州',
  北海道旅客鉄道: 'JR北海道',
  四国旅客鉄道: 'JR四国',
  // Subways / municipal
  東京地下鉄: '東京メトロ',
  東京都: '都営',
  大阪市高速電気軌道: '大阪メトロ',
  名古屋市: '名古屋市営',
  横浜市: '横浜市営',
  神戸市: '神戸市営',
  京都市: '京都市営',
  札幌市: '札幌市営',
  仙台市: '仙台市営',
  福岡市: '福岡市営',
  // Trams (路面) — short, recognizable
  熊本市: '熊本市電',
  鹿児島市: '鹿児島市電',
  函館市: '函館市電',
  一般社団法人札幌市交通事業振興公社: '札幌市電',
  // Major private — brand short forms (mirror pipeline/line-style.ts LINE_PREFIX_BY_OPERATOR)
  東急電鉄: '東急',
  京王電鉄: '京王',
  京成電鉄: '京成',
  京浜急行電鉄: '京急',
  小田急電鉄: '小田急',
  西武鉄道: '西武',
  東武鉄道: '東武',
  相模鉄道: '相鉄',
  近畿日本鉄道: '近鉄',
  南海電気鉄道: '南海',
  京阪電気鉄道: '京阪',
  阪急電鉄: '阪急',
  阪神電気鉄道: '阪神',
  名古屋鉄道: '名鉄',
  西日本鉄道: '西鉄',
};

/** Strip legal-entity noise from an unmapped formal operator name. */
function stripLegal(operator: string): string {
  return operator
    .replace(/(?:株式会社|有限会社)/g, '')
    .replace(/^(?:一般社団法人|一般財団法人|公益社団法人|公益財団法人|地方独立行政法人)/, '')
    .trim();
}

/** The short display label for an operator (mapped, else cleaned formal name). */
export function companyLabel(operator?: string): string {
  if (!operator) return '';
  return COMPANY_LABELS[operator] ?? stripLegal(operator);
}

/**
 * The company label to render for a line, with de-dup: returns '' when the line name
 * already leads with the company brand (`東急東横線` already says 東急) so the row stays clean.
 */
export function companyFor(operator: string | undefined, lineName: string): string {
  const label = companyLabel(operator);
  if (!label) return '';
  if (lineName.startsWith(label)) return '';
  if (operator && lineName.startsWith(operator)) return '';
  return label;
}
