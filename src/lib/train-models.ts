// Minimal known-model → top service speed (km/h) lookup, used only to resolve
// CoverageResult.fastestTrainModel from the train models a user logged. Neither the
// package nor RideEvent carries speed, so "fastest" needs this small reference table.
// Names are matched case-insensitively after stripping spaces/hyphens, so "E5", "e5",
// and "E5系" all hit. Unknown models simply don't participate in the "fastest" pick.

const TOP_SPEED_KMH: Record<string, number> = {
  // 中国 CR 系列（复兴号 / 和谐号）
  cr400af: 350,
  cr400bf: 350,
  cr400: 350,
  cr300af: 250,
  cr300bf: 250,
  cr200j: 160,
  crh380a: 350,
  crh380b: 350,
  crh2: 250,
  crh3: 350,
  // 新幹線
  e5: 320,
  h5: 320,
  e6: 320,
  e7: 260,
  w7: 260,
  e2: 275,
  e3: 275,
  n700s: 285,
  n700a: 285,
  n700: 285,
  '700': 285,
  '500': 285,
  '800': 260,
};

export function canonicalizeTrainModel(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed
    .replace(/\bseries\b/giu, '')
    .replace(/[系形型]\s*$/u, '')
    .replace(/[\s\u3000\-_]+/gu, '')
    .toUpperCase();
}

export const KNOWN_TRAIN_MODELS: string[] = Object.keys(TOP_SPEED_KMH).map(canonicalizeTrainModel);

function normalizeModel(model: string): string {
  return canonicalizeTrainModel(model).toLowerCase();
}

/** Top speed for a logged model, or undefined if unknown. */
export function topSpeedKmh(model: string | undefined): number | undefined {
  if (!model) return undefined;
  return TOP_SPEED_KMH[normalizeModel(model)];
}
