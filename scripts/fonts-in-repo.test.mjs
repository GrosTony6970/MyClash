/**
 * No app build asks a font server.
 *
 * The three Next apps loaded their typefaces through the Google loader of next/font, which
 * fetches the files from Google each time an app is built or started. A slow answer failed the
 * build: a red CI job, and on the day of an Event a deploy that cannot run. The files are in
 * `packages/ui/src/fonts/` now, and each layout loads the Latin one through `next/font/local`.
 *
 * It is a script test, not a test of `@myclash/ui`: it reads the apps, and that package's cached
 * test result does not know when an app's layout changes.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const APPS = ['web-public', 'web-admin', 'web-staff'];
/** The Latin file of each family, with the weights the apps asked Google for. */
const LATIN = {
  'fraunces-latin-opsz-normal.woff2': '100 900',
  'geist-latin-wght-normal.woff2': '400 700',
  'jetbrains-mono-latin-wght-normal.woff2': '400 500',
};
const GOOGLE = /next\/font\/google|fonts\.googleapis|fonts\.gstatic/;

const layoutOf = (app) => join(repo, 'apps', app, 'app', 'layout.tsx');

for (const app of APPS) {
  test(`${app}: the layout loads each Latin file from the repo, with the weights Google served`, () => {
    const source = readFileSync(layoutOf(app), 'utf8');
    assert.match(source, /import localFont from 'next\/font\/local';/);
    for (const [file, weight] of Object.entries(LATIN)) {
      const src = `../../../packages/ui/src/fonts/${file}`;
      const call = source.split('localFont(').find((part) => part.includes(`src: '${src}',`));
      assert.ok(call, `${app} does not load ${file}`);
      assert.ok(
        call.slice(0, call.indexOf('});')).includes(`weight: '${weight}',`),
        `${app} declares another weight range than ${weight} for ${file}`,
      );
      assert.ok(existsSync(join(dirname(layoutOf(app)), src)), `${src} is not a file`);
    }
  });
}

test('no source file of an app loads a font from Google', () => {
  const sources = APPS.flatMap((app) =>
    ['app', 'src'].flatMap((dir) =>
      readdirSync(join(repo, 'apps', app, dir), { recursive: true })
        .filter((file) => /\.(tsx?|css)$/.test(file))
        .map((file) => join('apps', app, dir, file)),
    ),
  );
  // Every app is read: three empty folders would pass.
  assert.ok(sources.length > 1000, `only ${sources.length} source files were read`);
  const offenders = sources.filter((file) => GOOGLE.test(readFileSync(join(repo, file), 'utf8')));
  assert.deepEqual(offenders, []);
});
