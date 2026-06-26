import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

// Sole writer of the integrity manifest (schema v2, per-file SHA-256). build-jp produces the
// packages + migration maps but NEVER the manifest, so verify-jp rebuilding a package can't clobber
// the sha-bearing manifest. Everything here is derived from files on disk → deterministic rebuild.
const MANIFEST_PATH = 'public/rail/manifest.json';
const JP_PACKAGE_PATH = 'rail/jp-2025.json';
const CN_PACKAGE_PATH = 'rail/cn-jinghu-2025.json';

type RailPackage = {
  version?: unknown;
  generatedAt?: unknown;
};

type MigrationMap = {
  fromVersion?: unknown;
  toVersion?: unknown;
};

type MigrationEntry = {
  fromVersion: string;
  toVersion: string;
  path: string;
  sha256: string;
};

function readRequiredBytes(path: string): Buffer {
  if (!existsSync(path)) {
    throw new Error(`Missing required manifest input: ${path}`);
  }
  return readFileSync(path);
}

function readJson<T>(path: string): T {
  return JSON.parse(readRequiredBytes(path).toString('utf8')) as T;
}

function publicPath(manifestPath: string): string {
  return `public/${manifestPath}`;
}

function sha256(manifestPath: string): string {
  return createHash('sha256').update(readRequiredBytes(publicPath(manifestPath))).digest('hex');
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

// Discover a namespace's migration steps by SCANNING its maps directory — each map carries its own
// from/to, so the maps are the source of truth (no dependency on a manifest build-jp used to write).
function discoverMigrations(ns: string): MigrationEntry[] {
  const dir = `public/rail/migrations/${ns}`;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => {
      const manifestPath = `rail/migrations/${ns}/${file}`;
      const map = readJson<MigrationMap>(publicPath(manifestPath));
      return {
        fromVersion: requiredString(map.fromVersion, `${manifestPath} fromVersion`),
        toVersion: requiredString(map.toVersion, `${manifestPath} toVersion`),
        path: manifestPath,
        sha256: sha256(manifestPath),
      };
    });
}

const jpPackage = readJson<RailPackage>(publicPath(JP_PACKAGE_PATH));
const cnPackage = readJson<RailPackage>(publicPath(CN_PACKAGE_PATH));

const jpVersion = requiredString(jpPackage.version, `${publicPath(JP_PACKAGE_PATH)} version`);
const cnVersion = requiredString(cnPackage.version, `${publicPath(CN_PACKAGE_PATH)} version`);
const generatedAt = requiredString(jpPackage.generatedAt, `${publicPath(JP_PACKAGE_PATH)} generatedAt`);

const manifest = {
  schemaVersion: 2,
  generatedAt,
  packages: {
    JP: {
      version: jpVersion,
      path: JP_PACKAGE_PATH,
      sha256: sha256(JP_PACKAGE_PATH),
      migrations: discoverMigrations('jp'),
    },
    CN: {
      version: cnVersion,
      path: CN_PACKAGE_PATH,
      sha256: sha256(CN_PACKAGE_PATH),
      migrations: discoverMigrations('cn'),
    },
  },
};

writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${MANIFEST_PATH}`);
