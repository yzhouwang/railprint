import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BuildInput } from './build-package.ts';
import { buildRailGeoPackage } from './build-package.ts';

interface CliArgs {
  input: string;
  out: string;
}

const args = parseArgs(process.argv.slice(2));
const input = JSON.parse(await readFile(args.input, 'utf8')) as BuildInput;
const result = buildRailGeoPackage(input);
const country = result.railGeoPackage.country.toLowerCase();

await mkdir(args.out, { recursive: true });
await writeJson(path.join(args.out, `${country}-rail-geo-package.json`), result.railGeoPackage);
await writeJson(path.join(args.out, `${country}-segments.geojson`), result.segmentFeatures);
await writeJson(path.join(args.out, `${country}-validation-report.json`), result.validationReport);
await writeJson(path.join(args.out, `${country}-override-required.json`), {
  schemaVersion: 1,
  lines: result.validationReport.lines
    .filter((line) => line.status === 'requires-override')
    .map((line) => ({ lineId: line.lineId, name: line.name, issues: line.issues })),
});

function parseArgs(argv: string[]): CliArgs {
  const input = readFlag(argv, '--input');
  const out = readFlag(argv, '--out');
  if (!input || !out) {
    throw new Error('Usage: node pipeline/cli.ts --input <build-input.json> --out <output-dir>');
  }
  return { input, out };
}

function readFlag(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return argv[index + 1];
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

