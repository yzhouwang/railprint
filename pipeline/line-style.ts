import { n02LineReadingKey } from './build-readings.ts';
import { lineNameAliases, operatorAliases, stripWikiParen } from './line-aliases.ts';

export type LineColorSource = 'sourced' | 'operator-default' | 'shinkansen-default';

export interface LineStyle {
  color: string;
  colorSource: LineColorSource;
  logoFile?: string;
  logoSrc?: string;
}

export interface LineStyleInput {
  operator: string;
  name: string;
  n02_002?: string;
}

interface WikiStyleBinding {
  op?: { value?: string };
  ja?: { value?: string };
  color?: { value?: string };
  logo?: { value?: string };
}

export interface WikiStyleCache {
  results?: { bindings?: WikiStyleBinding[] };
}

export interface LogoIndexEntry {
  file: string;
  src: string;
}

export type LogoIndex = Record<string, LogoIndexEntry>;

interface SourceStyle {
  operator: string;
  name: string;
  color?: string;
  logoSrc?: string;
}

export type JrOperatorFamily =
  | 'jr-east'
  | 'jr-west'
  | 'jr-central'
  | 'jr-kyushu'
  | 'jr-hokkaido'
  | 'jr-shikoku';

const JR_OPERATOR_FAMILIES: { operatorPrefix: string; family: JrOperatorFamily; tokens: string[] }[] = [
  { operatorPrefix: '東日本旅客鉄道', family: 'jr-east', tokens: ['JR J', 'Shinkansen jre'] },
  { operatorPrefix: '西日本旅客鉄道', family: 'jr-west', tokens: ['JRW ', 'Shinkansen jrw'] },
  { operatorPrefix: '東海旅客鉄道', family: 'jr-central', tokens: ['Shinkansen jrc', 'JR Central'] },
  { operatorPrefix: '九州旅客鉄道', family: 'jr-kyushu', tokens: ['JRK', 'Shinkansen jrk'] },
  { operatorPrefix: '北海道旅客鉄道', family: 'jr-hokkaido', tokens: ['JRH', 'Shinkansen jrh'] },
  { operatorPrefix: '四国旅客鉄道', family: 'jr-shikoku', tokens: ['JRS', 'Shikoku'] },
];

const OPERATOR_DEFAULT_COLORS: Record<string, string> = {
  '北海道旅客鉄道': '#2CB431',
  '東日本旅客鉄道': '#00A7E3',
  '東海旅客鉄道': '#F77321',
  '西日本旅客鉄道': '#0072BC',
  '四国旅客鉄道': '#1CADCA',
  '九州旅客鉄道': '#E50012',
  '東京地下鉄': '#109ED4',
  '東京都': '#B6007A',
  '大阪市高速電気軌道': '#522886',
  '名古屋市': '#FABE00',
  '福岡市': '#E51E2A',
  '札幌市': '#00843D',
  '京都市': '#009F6B',
  '仙台市': '#00A0E9',
  '横浜市': '#0068B7',
  '神戸市': '#00A1E9',
  '京王電鉄': '#DD0077',
  '京成電鉄': '#005AAA',
  '京浜急行電鉄': '#00A3E0',
  '近畿日本鉄道': '#F04A00',
  '小田急電鉄': '#2288CC',
  '西武鉄道': '#0072BC',
  '東急電鉄': '#E60012',
  '東武鉄道': '#0067B1',
  '南海電気鉄道': '#009A44',
  '阪急電鉄': '#6F2C3F',
  '阪神電気鉄道': '#F5A200',
  '名古屋鉄道': '#D71920',
};

const SHINKANSEN_DEFAULT_COLORS: Record<string, string> = {
  '北海道新幹線': '#2CB431',
  '東北新幹線': '#008000',
  '上越新幹線': '#008000',
  '北陸新幹線': '#008000',
  '東海道新幹線': '#0000CD',
  '山陽新幹線': '#0073BC',
  '九州新幹線': '#FF0000',
  '西九州新幹線': '#FF0000',
};

const FALLBACK_OPERATOR_PALETTE = [
  '#5B6C8F',
  '#3B7A57',
  '#8B5E3C',
  '#7B5EA7',
  '#2F7F8F',
  '#9A4F6B',
  '#6B7C2E',
  '#4F6FA8',
];

export function isValidHexColor(value: string | undefined): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(value ?? '');
}

function normalizeSourceHex(value: string | undefined): string | undefined {
  const raw = value?.trim().replace(/^#/, '').toUpperCase();
  return /^[0-9A-F]{6}$/.test(raw ?? '') ? `#${raw}` : undefined;
}

function unique<T>(values: Iterable<T | undefined>): T[] {
  return [...new Set([...values].filter((v): v is T => v !== undefined))];
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function firstSorted(values: Iterable<string | undefined>): string | undefined {
  return unique(values).sort(compareText)[0];
}

export function logoFilenameFromSrc(src: string): string {
  const raw = src.split('/FilePath/')[1] ?? src.split('/').pop() ?? src;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function jrOperatorLogoTokens(operator: string): string[] | null {
  const family = JR_OPERATOR_FAMILIES.find((entry) => operator.startsWith(entry.operatorPrefix));
  return family ? family.tokens : null;
}

export function logoMatchesOperatorFamily(operator: string, logoSrc: string): boolean {
  const tokens = jrOperatorLogoTokens(operator);
  if (!tokens) return true;
  const filename = logoFilenameFromSrc(logoSrc).toLowerCase();
  return tokens.some((token) => filename.includes(token.toLowerCase()));
}

function buildLogoSourceMap(logoIndex: LogoIndex): Map<string, LogoIndexEntry> {
  const entries = Object.values(logoIndex)
    .filter((entry) => entry.file && entry.src)
    .sort((a, b) => compareText(a.src, b.src) || compareText(a.file, b.file));
  const bySrc = new Map<string, LogoIndexEntry>();
  for (const entry of entries) {
    if (!bySrc.has(entry.src)) bySrc.set(entry.src, entry);
  }
  return bySrc;
}

function hashOperator(operator: string): number {
  let h = 0;
  for (const ch of operator) h = (Math.imul(h, 31) + ch.codePointAt(0)!) >>> 0;
  return h;
}

function defaultColor(line: LineStyleInput): { color: string; source: LineColorSource } {
  if (line.n02_002 === '1' || line.name.endsWith('新幹線')) {
    return { color: SHINKANSEN_DEFAULT_COLORS[line.name] ?? '#008000', source: 'shinkansen-default' };
  }
  const color = OPERATOR_DEFAULT_COLORS[line.operator]
    ?? FALLBACK_OPERATOR_PALETTE[hashOperator(line.operator) % FALLBACK_OPERATOR_PALETTE.length];
  return { color, source: 'operator-default' };
}

export function fallbackLineStyle(line: LineStyleInput): LineStyle {
  const fallback = defaultColor(line);
  return { color: fallback.color, colorSource: fallback.source };
}

function parseSourceStyles(cache: WikiStyleCache): SourceStyle[] {
  const seen = new Set<string>();
  const rows: SourceStyle[] = [];
  for (const b of cache.results?.bindings ?? []) {
    const operator = b.op?.value?.trim();
    const rawName = b.ja?.value?.trim();
    if (!operator || !rawName) continue;
    const name = stripWikiParen(rawName);
    const color = normalizeSourceHex(b.color?.value);
    const logoSrc = b.logo?.value?.trim();
    const sig = JSON.stringify({ operator, name, color, logoSrc });
    if (seen.has(sig)) continue;
    seen.add(sig);
    rows.push({ operator, name, color, logoSrc });
  }
  return rows;
}

function firstUniqueSourceStyle(
  operator: string,
  rows: SourceStyle[],
  logoBySrc: Map<string, LogoIndexEntry>,
): Pick<SourceStyle, 'color' | 'logoSrc' | 'name'> {
  const logoCandidates = unique(rows.map((r) => r.logoSrc))
    .filter((src) => logoBySrc.has(src))
    .sort(compareText);
  const familyTokens = jrOperatorLogoTokens(operator);
  const logoSrc = familyTokens
    ? logoCandidates.find((src) => logoMatchesOperatorFamily(operator, src))
    : logoCandidates[0];
  return {
    name: rows[0]?.name ?? '',
    color: firstSorted(rows.map((r) => r.color)),
    logoSrc,
  };
}

export function buildLineStyleIndex(
  lines: LineStyleInput[],
  wikidataStyle: WikiStyleCache,
  logoIndex: LogoIndex = {},
): Record<string, LineStyle> {
  const rows = parseSourceStyles(wikidataStyle);
  const logoBySrc = buildLogoSourceMap(logoIndex);
  const byKey = new Map<string, SourceStyle[]>();
  for (const row of rows) {
    const key = n02LineReadingKey(row.operator, row.name);
    (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(row);
  }

  const out: Record<string, LineStyle> = {};
  for (const line of lines) {
    const key = n02LineReadingKey(line.operator, line.name);
    const aliases = lineNameAliases(line.operator, line.name);
    let match: Pick<SourceStyle, 'color' | 'logoSrc' | 'name'> | undefined;

    for (const name of aliases) {
      const opRows = operatorAliases(line.operator).flatMap((op) => byKey.get(n02LineReadingKey(op, name)) ?? []);
      if (opRows.length) {
        match = firstUniqueSourceStyle(line.operator, opRows, logoBySrc);
        break;
      }
    }

    const fallback = fallbackLineStyle(line);
    const style: LineStyle = {
      color: match?.color ?? fallback.color,
      colorSource: match?.color ? 'sourced' : fallback.colorSource,
    };
    if (match?.logoSrc) {
      const logo = logoBySrc.get(match.logoSrc);
      if (logo?.file) {
        style.logoFile = logo.file;
        style.logoSrc = logo.src;
      }
    }
    out[key] = style;
  }
  return out;
}

export function logoCredit(style: LineStyle): { src: string; license: 'Wikimedia Commons' } | null {
  return style.logoSrc ? { src: style.logoSrc, license: 'Wikimedia Commons' } : null;
}
