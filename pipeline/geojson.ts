export type Position = [number, number];

export interface LineString {
  type: 'LineString';
  coordinates: Position[];
}

export interface Point {
  type: 'Point';
  coordinates: Position;
}

export interface Feature<
  Geometry extends LineString | Point = LineString,
  Properties extends Record<string, unknown> = Record<string, unknown>,
> {
  type: 'Feature';
  geometry: Geometry;
  properties: Properties;
}

export interface FeatureCollection<
  Geometry extends LineString | Point = LineString,
  Properties extends Record<string, unknown> = Record<string, unknown>,
> {
  type: 'FeatureCollection';
  features: Feature<Geometry, Properties>[];
}

