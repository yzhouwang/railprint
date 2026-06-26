function unique<T>(values: Iterable<T | undefined>): T[] {
  return [...new Set([...values].filter((v): v is T => v !== undefined))];
}

const OPERATOR_ALIASES: Record<string, string[]> = {
  'アイジーアールいわて銀河鉄道': ['IGRいわて銀河鉄道'],
  '京都市': ['京都市営地下鉄', '京都市交通局'],
  '札幌市': ['札幌市営地下鉄', '札幌市交通局'],
  '仙台市': ['仙台市地下鉄', '仙台市交通局'],
  '大阪市高速電気軌道': ['大阪市交通局'],
  '東京都': ['東京都交通局'],
  '東京地下鉄': ['帝都高速度交通営団'],
  '名古屋市': ['名古屋市交通局', '名古屋市営地下鉄'],
  '福岡市': ['福岡市交通局', '福岡市地下鉄'],
  '横浜市': ['横浜市交通局'],
  '神戸市': ['神戸市交通局'],
  '東海旅客鉄道': ['東海旅客鉄道新幹線鉄道事業本部'],
  '東日本旅客鉄道': ['東日本旅客鉄道新幹線統括本部', '東日本旅客鉄道大宮支社'],
  '西日本旅客鉄道': ['西日本旅客鉄道金沢支社', '西日本旅客鉄道新幹線鉄道事業本部'],
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

const HANKYU_MAIN_ALIASES = new Map([
  ['京都線', '阪急京都本線'],
  ['神戸線', '阪急神戸本線'],
  ['宝塚線', '阪急宝塚本線'],
]);

const EXACT_LINE_ALIASES = new Map([
  ['首都圏新都市鉄道\u0000常磐新線', 'つくばエクスプレス'],
  ['広島高速交通\u0000広島新交通1号線', 'アストラムライン'],
  ['東京臨海高速鉄道\u0000臨海副都心線', '東京臨海高速鉄道りんかい線'],
  ['名古屋臨海高速鉄道\u0000西名古屋港線', 'あおなみ線'],
  ['東武鉄道\u0000東上本線', '東武東上線'],
  ['東武鉄道\u0000野田線', '東武アーバンパークライン'],
  ['東京都\u0000荒川線', '都電荒川線'],
  ['西日本旅客鉄道\u0000北陸線', '北陸本線'],
  ['西日本旅客鉄道\u0000本四備讃線', '瀬戸大橋線'],
  ['東海旅客鉄道\u0000高山線', '高山本線'],
  ['東海旅客鉄道\u0000中央線', '中央西線'],
]);

export function stripWikiParen(label: string): string {
  let out = label.trim();
  for (;;) {
    const next = out.replace(/\s*(?:（[^（）]*）|\([^()]*\))\s*$/u, '').trim();
    if (next === out) return out;
    out = next;
  }
}

export function operatorAliases(operator: string): string[] {
  return unique([operator, ...(OPERATOR_ALIASES[operator] ?? [])]);
}

function subwayInnerName(name: string): string | undefined {
  const m = /^\d+号線[（(]?(.+?)[）)]?$/u.exec(name);
  return m?.[1];
}

export function lineNameAliases(operator: string, name: string): string[] {
  const names = [name, `${operator}${name}`];
  if (!name.endsWith('線')) names.push(`${operator}${name}線`);
  const inner = subwayInnerName(name);
  if (inner) {
    names.push(inner);
    if (operator === '東京地下鉄') names.push(`東京メトロ${inner}`);
    if (operator === '東京都') names.push(`都営地下鉄${inner}`);
    if (operator === '大阪市高速電気軌道') names.push(`大阪市営地下鉄${inner}`);
  }

  const prefix = LINE_PREFIX_BY_OPERATOR[operator];
  if (prefix) names.push(`${prefix}${name}`);

  if (operator === '横浜市') {
    if (name === '1号線' || name === '3号線') names.push('横浜市営地下鉄ブルーライン');
    if (name === '4号線') names.push('横浜市営地下鉄グリーンライン');
  }
  if (operator === '神戸市') {
    if (name === '海岸線') names.push('神戸市営地下鉄海岸線');
    if (name === '北神線') names.push('神戸市営地下鉄北神線');
    if (name === '山手線' || name === '西神線' || name === '西神延伸線') names.push('神戸市営地下鉄西神・山手線');
  }
  if (operator === '札幌市' || operator === '仙台市' || operator === '京都市') {
    names.push(`${operator}営地下鉄${name}`);
  }
  if (operator === '阪急電鉄') {
    const alias = HANKYU_MAIN_ALIASES.get(name);
    if (alias) names.push(alias);
  }

  const exactAlias = EXACT_LINE_ALIASES.get(`${operator}\u0000${name}`);
  if (exactAlias) names.push(exactAlias);

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
