// Resolve a package-data asset path against the app's base URL. The railnet package data carries
// ROOT-ABSOLUTE asset paths (e.g. `line.logo = '/rail/logos/….png'`) — correct when the app is
// served at the domain root, broken under subpath hosting (GitHub Pages project site serves at
// /railprint/). Rather than regenerate 349 logo paths in the data (a railnet data release for a
// display concern), resolve at the consumption edge: a leading '/' means "app root", so prefix
// Vite's BASE_URL. Non-absolute paths (or full URLs) pass through untouched.

/** `base` is injectable for tests; BASE_URL always ends with '/'. A protocol-relative
 *  URL ('//cdn…') is an absolute URL, not an app-root path — pass it through untouched
 *  (the rail-geo program plans CDN-hosted assets; mangling those would 404 silently). */
export function assetUrl(path: string, base: string = import.meta.env.BASE_URL): string {
  return path.startsWith('/') && !path.startsWith('//') ? `${base}${path.slice(1)}` : path;
}
