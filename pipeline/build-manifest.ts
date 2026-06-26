import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const MANIFEST_PATH = 'public/rail/manifest.json';
const JP_PACKAGE_PATH = 'rail/jp-2025.json';
const CN_PACKAGE_PATH = 'rail/cn-jinghu-2025.json';

type ExistingMigration = {
  fromVersion?: unknown;
  toVersion?: unknown;
  path?: unknown;
};

type ExistingManifest = {
  packages?: {
    JP?: {
      migrations?: ExistingMigration[];
    };
  };
};

type RailPackage = {
  version?: unknown;
  generatedAt?: unknown;
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

const existingManifest = readJson<ExistingManifest>(MANIFEST_PATH);
const jpPackage = readJson<RailPackage>(publicPath(JP_PACKAGE_PATH));
const cnPackage = readJson<RailPackage>(publicPath(CN_PACKAGE_PATH));

const jpVersion = requiredString(jpPackage.version, `${publicPath(JP_PACKAGE_PATH)} version`);
const cnVersion = requiredString(cnPackage.version, `${publicPath(CN_PACKAGE_PATH)} version`);
const generatedAt = requiredString(jpPackage.generatedAt, `${publicPath(JP_PACKAGE_PATH)} generatedAt`);

const jpMigrations = existingManifest.packages?.JP?.migrations ?? [];
const migrations = jpMigrations.map((migration, index) => {
  const fromVersion = requiredString(migration.fromVersion, `JP migration ${index} fromVersion`);
  const toVersion = requiredString(migration.toVersion, `JP migration ${index} toVersion`);
  const path = requiredString(migration.path, `JP migration ${index} path`);
  return {
    fromVersion,
    toVersion,
    path,
    sha256: sha256(path),
  };
});

const manifest = {
  schemaVersion: 2,
  generatedAt,
  packages: {
    JP: {
      version: jpVersion,
      path: JP_PACKAGE_PATH,
      sha256: sha256(JP_PACKAGE_PATH),
      migrations,
    },
    CN: {
      version: cnVersion,
      path: CN_PACKAGE_PATH,
      sha256: sha256(CN_PACKAGE_PATH),
      migrations: [],
    },
  },
};

writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${MANIFEST_PATH}`);
