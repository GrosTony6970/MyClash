/**
 * Every reader of a mailed link reads the code under the name the mail gives it.
 *
 * The API builds each mailed link itself: one of our doors with the one-time code as
 * `?token_hash=` (`apps/api/src/modules/mail/mailed-link.ts`, operator ruling 303). Four readers
 * take that code: the sign-in door, the sign-up door, and the reset page of each web app. A
 * rename on one side only would leave every mail of that kind dead, and each side's own tests
 * green.
 *
 * It is a script test, not a test of the API: it reads two apps too, and a package's cached
 * test result does not know when another app's page changes.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(repo, ...parts), 'utf8');

const NAME = 'token_hash';

test('the mail carries the code as ?token_hash=', () => {
  const owner = read('apps', 'api', 'src', 'modules', 'mail', 'mailed-link.ts');
  assert.ok(owner.includes(`}${NAME}=\${encodeURIComponent(code)}`));
});

test('auth.controller.ts: the sign-in door reads the code from that query name', () => {
  const source = read('apps', 'api', 'src', 'modules', 'auth', 'auth.controller.ts');
  assert.ok(source.includes(`@Query('${NAME}') tokenHash: string`));
});

// The sign-up mails open a page that keeps the code and sends it to its door
// (ruling "Pre-takeover"): the page reads it from the address.
for (const [app, page] of [
  ['web-admin', 'reset-password'],
  ['web-public', 'reset-password'],
  ['web-admin', 'auth/choose-password'],
  ['web-public', 'auth/choose-password'],
]) {
  test(`${app}: the ${page} page reads the code from that query name`, () => {
    const source = read('apps', app, 'app', ...page.split('/'), 'page.tsx');
    assert.ok(/(query|searchParams|link\??)\.get\('token_hash'\)/.test(source));
  });
}
