/**
 * The privacy pages' "Last updated" line against the version every stored
 * acceptance points at. Runs over the BUILT site, like site.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, '..', 'dist');
const REPO_ROOT = resolve(HERE, '..', '..', '..');

const EN = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const FR = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

test('the privacy pages say the date LEGAL_POLICIES gives as their version', () => {
  /*
   * Three hand edits must agree: the privacy version in legal.ts (what every
   * stored acceptance points at) and the "Last updated" line of both pages. A
   * version that drifts from the published text points acceptances at a
   * document nobody can produce. Reads the `version:` inside the `privacy:`
   * block only — legal.ts holds one per document. French writes the 1st as
   * "1er", so the date is built from a table, not Intl.
   */
  assert.ok(existsSync(DIST), 'dist/ is missing — build the marketing site first.');
  const legal = readFileSync(join(REPO_ROOT, 'packages', 'types', 'src', 'legal.ts'), 'utf8');
  const version = /privacy:\s*\{[^}]*?version:\s*'(\d{4})-(\d{2})-(\d{2})'/su.exec(legal);
  assert.ok(version, 'could not read the privacy version from legal.ts');
  const [, year, month, day] = version;
  const d = Number(day);
  const m = Number(month) - 1;
  const expected = {
    'en/privacypolicy': `Last updated: ${d} ${EN[m]} ${year}`,
    privacypolicy: `Dernière mise à jour : ${d === 1 ? '1er' : d} ${FR[m]} ${year}`,
  };
  for (const [route, line] of Object.entries(expected)) {
    const html = readFileSync(join(DIST, route, 'index.html'), 'utf8');
    const date = /<p class="policy__date">([^<]*)<\/p>/u.exec(html)?.[1];
    assert.equal(date, line, `/${route} does not show the privacy version's date`);
  }
});
