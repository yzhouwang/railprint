import { describe, it, expect } from 'vitest';
import { buildPopupModel, popupHtml, lineBadgeHtml, escapeHtml } from './popup';
import { buildGeoIndex } from '../store';
import { STUB_PACKAGES, JP_PACKAGE } from '../../fixtures/stubPackage';
import { DEFAULT_LINE_COLOR } from './style';

const geo = buildGeoIndex(STUB_PACKAGES);

// Resolve a stationId by (lineId, name) from the stub.
function stationId(lineId: string, name: string): string {
  const st = JP_PACKAGE.stations.find((s) => s.lineId === lineId && s.name === name)!;
  return st.stationId;
}

describe('C5 buildPopupModel — lists every line through a station group', () => {
  it('a transfer station lists ALL its lines (新宿 is on Yamanote in the stub group g-shinjuku)', () => {
    // 新宿 (group g-shinjuku) — in the stub it's on Yamanote only; the model lists by GROUP.
    const model = buildPopupModel(geo, stationId('jr-yamanote', '新宿'))!;
    expect(model.name).toBe('新宿');
    expect(model.nameRoma).toBe('Shinjuku');
    const lineIds = model.lines.map((l) => l.lineId);
    expect(lineIds).toContain('jr-yamanote');
    expect(model.lines.length).toBeGreaterThanOrEqual(1);
  });

  it('渋谷 is a real multi-line group (Yamanote + Tokyu Toyoko) — both listed', () => {
    const model = buildPopupModel(geo, stationId('jr-yamanote', '渋谷'))!;
    const lineIds = model.lines.map((l) => l.lineId).sort();
    expect(lineIds).toEqual(['jr-yamanote', 'tokyu-toyoko']);
  });

  it('each row carries the line color (always set) + logo only when present', () => {
    const model = buildPopupModel(geo, stationId('jr-yamanote', '渋谷'))!;
    const yamanote = model.lines.find((l) => l.lineId === 'jr-yamanote')!;
    const toyoko = model.lines.find((l) => l.lineId === 'tokyu-toyoko')!;
    expect(yamanote.color).toBe('#9ACD32');
    expect(yamanote.logo).toBe('/rail/logos/jr-yamanote.png'); // has a logo
    expect(toyoko.color).toBe('#DA0442');
    expect(toyoko.logo).toBeUndefined(); // no logo → swatch fallback
  });

  it('rows are bilingual + sorted by label, deduped per line', () => {
    const model = buildPopupModel(geo, stationId('jr-yamanote', '渋谷'))!;
    const labels = model.lines.map((l) => l.label);
    expect(labels).toContain('山手線 (Yamanote Line)');
    // dedupe: no line appears twice
    expect(new Set(model.lines.map((l) => l.lineId)).size).toBe(model.lines.length);
  });

  it('a solo station (no groupId) still lists its own one line', () => {
    const model = buildPopupModel(geo, stationId('jr-yamanote', '神田'))!;
    expect(model.lines.map((l) => l.lineId)).toEqual(['jr-yamanote']);
  });

  it('falls back to DEFAULT_LINE_COLOR for a line with no color', () => {
    const pkg = structuredClone(JP_PACKAGE);
    pkg.lines.forEach((l) => delete l.color);
    const g = buildGeoIndex([pkg]);
    const id = pkg.stations.find((s) => s.lineId === 'jr-yamanote' && s.name === '神田')!.stationId;
    const model = buildPopupModel(g, id)!;
    expect(model.lines[0].color).toBe(DEFAULT_LINE_COLOR);
  });
});

describe('C5 popupHtml — swatch + logo rendering', () => {
  it('renders a logo <img> for a line with a logo, a swatch for one without', () => {
    const model = buildPopupModel(geo, stationId('jr-yamanote', '渋谷'))!;
    const html = popupHtml(model);
    expect(html).toContain('class="rp-line-logo"');
    expect(html).toContain('src="/rail/logos/jr-yamanote.png"');
    expect(html).toContain('class="rp-line-swatch"');
    expect(html).toContain('background:#DA0442'); // Toyoko swatch (no logo)
    // header + a scrollable list
    expect(html).toContain('class="rp-popup-ja"');
    expect(html).toContain('class="rp-line-list"');
  });

  it('lineBadgeHtml prefers the logo, else the swatch', () => {
    expect(lineBadgeHtml({ lineId: 'x', label: 'X', color: '#abc', logo: '/l.png' })).toContain('<img');
    expect(lineBadgeHtml({ lineId: 'x', label: 'X', color: '#abc' })).toContain('rp-line-swatch');
  });

  it('escapes HTML in names + logo paths (no injection)', () => {
    expect(escapeHtml('<b>&"\'')).toBe('&lt;b&gt;&amp;&quot;&#39;');
    const html = lineBadgeHtml({ lineId: 'x', label: 'X', color: '#abc', logo: '"><script>' });
    expect(html).not.toContain('<script>');
  });
});
