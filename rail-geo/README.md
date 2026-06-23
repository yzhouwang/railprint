# rail-geo

Engine-lane output lives here: generated `RailGeoPackage` JSON/GeoJSON and later PMTiles.

Raw MLIT N02 and OSM downloads stay out of git under `data/raw/`; the pipeline is expected
to emit deterministic, versioned WGS84 artifacts here plus a validation report. Japan
artifacts must carry:

`出典「国土数値情報（鉄道データ）」（国土交通省）を加工して作成`

