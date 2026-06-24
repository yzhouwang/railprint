import { n02LineReadingKey } from './build-readings.ts';

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

const OPERATOR_ALIASES: Record<string, string[]> = {
  'アイジーアールいわて銀河鉄道': ['IGRいわて銀河鉄道'],
  '京都市': ['京都市営地下鉄', '京都市交通局'],
  '札幌市': ['札幌市営地下鉄', '札幌市交通局'],
  '仙台市': ['仙台市地下鉄', '仙台市交通局'],
  '東京都': ['東京都交通局'],
  '名古屋市': ['名古屋市交通局', '名古屋市営地下鉄'],
  '福岡市': ['福岡市交通局', '福岡市地下鉄'],
};

const LINE_PREFIX_BY_OPERATOR: Record<string, string> = {
  '京王電鉄': '京王',
  '京成電鉄': '京成',
  '京浜急行電鉄': '京急',
  '近畿日本鉄道': '近鉄',
  '小田急電鉄': '小田急',
  '西日本鉄道': '西鉄',
  '西武鉄道': '西武',
  '相模鉄道': '相鉄',
  '東急電鉄': '東急',
  '東武鉄道': '東武',
  '南海電気鉄道': '南海',
  '阪急電鉄': '阪急',
  '阪神電気鉄道': '阪神',
  '名古屋鉄道': '名鉄',
};

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

function stripWikiParen(label: string): string {
  let out = label.trim();
  for (;;) {
    const next = out.replace(/\s*(?:（[^（）]*）|\([^()]*\))\s*$/u, '').trim();
    if (next === out) return out;
    out = next;
  }
}

function normalizeSourceHex(value: string | undefined): string | undefined {
  const raw = value?.trim().replace(/^#/, '').toUpperCase();
  return /^[0-9A-F]{6}$/.test(raw ?? '') ? `#${raw}` : undefined;
}

function unique<T>(values: Iterable<T | undefined>): T[] {
  return [...new Set([...values].filter((v): v is T => v !== undefined))];
}

function operatorAliases(operator: string): string[] {
  return unique([operator, ...(OPERATOR_ALIASES[operator] ?? [])]);
}

function subwayInnerName(name: string): string | undefined {
  const m = /^\d+号線[（(]?(.+?)[）)]?$/u.exec(name);
  return m?.[1];
}

function lineNameAliases(operator: string, name: string): string[] {
  const names = [name];
  const inner = subwayInnerName(name);
  if (inner) {
    names.push(inner);
    if (operator === '東京地下鉄') names.push(`東京メトロ${inner}`);
  }

  const prefix = LINE_PREFIX_BY_OPERATOR[operator];
  if (prefix && !name.startsWith(prefix)) names.push(`${prefix}${name}`);

  if (/旅客鉄道$/u.test(operator)) {
    const main = new Map([
      ['中央線', '中央本線'],
      ['東海道線', '東海道本線'],
      ['山陽線', '山陽本線'],
      ['関西線', '関西本線'],
    ]);
    const alias = main.get(name);
    if (alias) names.push(alias);
  }

  return unique(names);
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

function firstUniqueSourceStyle(rows: SourceStyle[]): Pick<SourceStyle, 'color' | 'logoSrc' | 'name'> {
  return {
    name: rows[0]?.name ?? '',
    color: unique(rows.map((r) => r.color)).length === 1 ? unique(rows.map((r) => r.color))[0] : undefined,
    logoSrc: unique(rows.map((r) => r.logoSrc)).length === 1 ? unique(rows.map((r) => r.logoSrc))[0] : undefined,
  };
}

export function buildLineStyleIndex(
  lines: LineStyleInput[],
  wikidataStyle: WikiStyleCache,
  logoIndex: LogoIndex = {},
): Record<string, LineStyle> {
  const rows = parseSourceStyles(wikidataStyle);
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
        match = firstUniqueSourceStyle(opRows);
        break;
      }
    }

    const fallback = fallbackLineStyle(line);
    const style: LineStyle = {
      color: match?.color ?? fallback.color,
      colorSource: match?.color ? 'sourced' : fallback.colorSource,
    };
    if (match?.logoSrc) {
      const logo = logoIndex[match.name];
      if (logo?.file && logo.src === match.logoSrc) {
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
