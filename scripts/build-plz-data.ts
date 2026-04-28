/**
 * Build PLZ/Ort data files from GeoNames dumps.
 *
 * Data source: GeoNames (https://www.geonames.org/) — CC BY 4.0.
 * Download postal-code dumps from https://download.geonames.org/export/zip/
 *
 * Input:  /tmp/geonames/{CC}.txt  (tab-separated, 12 columns)
 * Output: ../public/plz-data/{CC}.json  (key = postal code, value = string or string[])
 *
 * Usage: yarn tsx scripts/build-plz-data.ts
 *
 * Notes on data hygiene:
 *  - GeoNames DE contains ~8k "corporate" special-ZIP records (no accuracy code)
 *    such as "Daimler Insurance Services GmbH" — filter those out.
 *  - Multiple communes can share a single postal code (common in AT/FR/IT) -> array.
 *  - LI (Liechtenstein) is tiny; no filtering needed.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';

type Shape = string | string[];

const INPUT_DIR = '/tmp/geonames';
const OUTPUT_DIR = resolve(__dirname, '..', 'public', 'plz-data');
const COUNTRIES: { code: string; filterEmptyAccuracy: boolean }[] = [
  { code: 'CH', filterEmptyAccuracy: true },
  { code: 'DE', filterEmptyAccuracy: true },
  { code: 'AT', filterEmptyAccuracy: true },
  { code: 'FR', filterEmptyAccuracy: true },
  { code: 'IT', filterEmptyAccuracy: true },
  { code: 'LI', filterEmptyAccuracy: false },
];

function buildCountry(cc: string, filterEmptyAccuracy: boolean): Shape extends never ? never : Record<string, Shape> {
  const inPath = join(INPUT_DIR, `${cc}.txt`);
  const raw = readFileSync(inPath, 'utf8');
  const byPlz = new Map<string, Set<string>>();

  let total = 0;
  let kept = 0;
  let filtered = 0;

  for (const line of raw.split('\n')) {
    if (!line) continue;
    total++;
    const cols = line.split('\t');
    // 0 country, 1 postalcode, 2 placename, 3 admin1, 4 admin1code, 5 admin2,
    // 6 admin2code, 7 admin3, 8 admin3code, 9 lat, 10 lon, 11 accuracy
    if (cols.length < 12) continue;
    const plz = (cols[1] ?? '').trim();
    const place = (cols[2] ?? '').trim();
    const accuracy = (cols[11] ?? '').trim();
    if (!plz || !place) continue;
    if (filterEmptyAccuracy && !accuracy) {
      filtered++;
      continue;
    }
    if (!byPlz.has(plz)) byPlz.set(plz, new Set());
    byPlz.get(plz)!.add(place);
    kept++;
  }

  // Sort keys deterministically and collapse single-entry sets to strings.
  const sorted = Array.from(byPlz.keys()).sort();
  const out: Record<string, Shape> = {};
  for (const plz of sorted) {
    const places = Array.from(byPlz.get(plz)!).sort();
    out[plz] = places.length === 1 ? places[0] : places;
  }

  console.log(`[${cc}] total=${total}  kept=${kept}  filtered=${filtered}  uniquePLZ=${sorted.length}`);
  return out;
}

function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const c of COUNTRIES) {
    const data = buildCountry(c.code, c.filterEmptyAccuracy);
    const outPath = join(OUTPUT_DIR, `${c.code}.json`);
    writeFileSync(outPath, JSON.stringify(data) + '\n', 'utf8');
    console.log(`  -> wrote ${outPath}`);
  }
  console.log('\nDone. Data © GeoNames (CC BY 4.0) — https://www.geonames.org/');
}

main();
