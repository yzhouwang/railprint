import { describe, it, expect } from 'vitest';
import { assetUrl } from './asset-url';

describe('assetUrl — package asset paths survive subpath hosting', () => {
  it('root-absolute data paths resolve against the app base (GitHub Pages project site)', () => {
    expect(assetUrl('/rail/logos/jr-yamanote.png', '/railprint/')).toBe('/railprint/rail/logos/jr-yamanote.png');
  });

  it('is the identity at root hosting (base "/") — today’s behavior unchanged', () => {
    expect(assetUrl('/rail/logos/jr-yamanote.png', '/')).toBe('/rail/logos/jr-yamanote.png');
  });

  it('leaves non-absolute paths and full URLs untouched', () => {
    expect(assetUrl('rail/logos/x.png', '/railprint/')).toBe('rail/logos/x.png');
    expect(assetUrl('https://example.com/x.png', '/railprint/')).toBe('https://example.com/x.png');
  });

  it('treats protocol-relative URLs as absolute (future CDN paths must not be mangled)', () => {
    expect(assetUrl('//cdn.example.com/x.png', '/railprint/')).toBe('//cdn.example.com/x.png');
  });

  it('defaults to import.meta.env.BASE_URL', () => {
    // vitest runs with BASE_URL '/', so the default matches the explicit-root case.
    expect(assetUrl('/rail/logos/x.png')).toBe('/rail/logos/x.png');
  });
});
