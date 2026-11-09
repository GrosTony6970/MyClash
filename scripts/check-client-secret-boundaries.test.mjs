import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildTimeEnvKeys,
  forbiddenEnvKeys,
  gate,
  mostSpecificMatches,
  publicEnvKeys,
  scanFrontendRoots,
  unclassifiedEnvKeys,
} from './check-client-secret-boundaries.mjs';

const repoRoot = join(import.meta.dirname, '..');

// The fixtures below are hand-written and use invented keys. None is derived
// from forbiddenEnvKeys: a fixture built from the thing under test cannot
// falsify it. The real list is exercised separately, as a property.

const KEYS = ['ALPHA_SECRET', 'SECRET', 'secret', 'UNRELATED_KEY'];

test('a subsumed key is not reported beside the longer key that matched', () => {
  // The defect this rule closes. 'SECRET' is inside 'ALPHA_SECRET', so the
  // naive "report every match" spelling names one leak twice under two labels
  // and reads as two problems.
  assert.deepEqual(mostSpecificMatches('const x = ALPHA_SECRET;', KEYS), ['ALPHA_SECRET']);

  // Falsifies the fix: the spelling this replaced still double-reports.
  const everyMatch = KEYS.filter((key) => 'const x = ALPHA_SECRET;'.includes(key));
  assert.deepEqual(everyMatch, ['ALPHA_SECRET', 'SECRET']);
});

test('a bare shorter key still reports when nothing longer matched', () => {
  // Subsumption is decided per FILE, not by the shape of the list. A component
  // naming the bare form is a finding even though a longer key exists that
  // would have hidden it — this is the case the whole rule risks swallowing.
  assert.deepEqual(mostSpecificMatches('const x = SECRET;', KEYS), ['SECRET']);
});

test('keys that differ only in case do not subsume each other', () => {
  // 'secret' is not a substring of 'SECRET'. Two distinct occurrences are two
  // findings, and an operator needs to see both spellings.
  assert.deepEqual(mostSpecificMatches('SECRET and secret', KEYS), ['SECRET', 'secret']);

  // And the upper-case form is still subsumed by a longer upper-case key when
  // one is present, while its lower-case twin survives beside it.
  assert.deepEqual(mostSpecificMatches('ALPHA_SECRET and secret', KEYS), [
    'ALPHA_SECRET',
    'secret',
  ]);
});

test('unrelated keys are reported alongside a subsumed pair', () => {
  assert.deepEqual(mostSpecificMatches('ALPHA_SECRET, UNRELATED_KEY', KEYS), [
    'ALPHA_SECRET',
    'UNRELATED_KEY',
  ]);
});

test('clean source reports nothing', () => {
  assert.deepEqual(mostSpecificMatches('export const apiUrl = "/api/v1";', KEYS), []);
});

test('the answer does not depend on the order of the key list', () => {
  // The filter reads `matched`, never the list's position. If that ever changes
  // to an index-based comparison, this is what catches it.
  const reversed = [...KEYS].reverse();
  assert.deepEqual(mostSpecificMatches('ALPHA_SECRET and secret', reversed).sort(), [
    'ALPHA_SECRET',
    'secret',
  ]);
});

// ── The real list ────────────────────────────────────────────────────────────

test('every forbidden key can still report itself', () => {
  // No key may be permanently shadowed. A key that can never be the answer is
  // dead weight pretending to be coverage — which is precisely the failure this
  // whole slice was about.
  for (const key of forbiddenEnvKeys) {
    assert.ok(
      mostSpecificMatches(`const leak = process.env.${key};`).includes(key),
      `${key} matched nothing but itself and was still dropped`,
    );
  }
});

test('the forbidden list has no duplicate entries', () => {
  // Two identical entries both survive the filter (`other !== key` compares
  // values), so a duplicate would report the same leak twice — the exact
  // outcome the rule exists to prevent.
  assert.deepEqual([...new Set(forbiddenEnvKeys)], forbiddenEnvKeys);
});

test('the keys taken over from infra:review are still in the list', () => {
  // check-infra-review.mjs deleted its per-file copies on the strength of these
  // living here. If one is dropped, the fact stops being guarded anywhere —
  // there is no longer a second gate to fall back on.
  for (const key of ['SERVICE_ROLE', 'service_role', 'SEED_ADMIN', 'SEED_ADMIN_PASSWORD']) {
    assert.ok(forbiddenEnvKeys.includes(key), `${key} was removed with no owner to replace it`);
  }
});

test('the photo bucket key pair is forbidden, and a component naming it reports', () => {
  // The photo bucket has its own key pair (operator, 2026-11-04). The API reads it; a browser
  // never has a reason to.
  for (const key of [
    'PHOTO_BUCKET_ACCESS_KEY',
    'PHOTO_BUCKET_SECRET_KEY',
    'PHOTO_TOKEN_SECRET',
    'PHOTO_DEVICE_JWT_SECRET',
  ]) {
    assert.ok(forbiddenEnvKeys.includes(key), `${key} is not guarded`);
    assert.deepEqual(mostSpecificMatches(`const k = process.env.${key};`, forbiddenEnvKeys), [key]);
  }
});

// ── .env.example: every secret-shaped name is classified (ruling 511) ───────

test('an unclassified secret-shaped name is reported, a classified or plain one is not', () => {
  const env = [
    'ALPHA_SECRET=x',
    'BETA_PASSWORD=x',
    'GAMMA_KEY=x',
    'DELTA_TOKEN=x',
    'OPEN_KEY=x',
    'PLAIN_URL=https://example.test',
    'BETA_PASSWORD=again',
  ].join('\n');
  assert.deepEqual(unclassifiedEnvKeys(env, ['ALPHA_SECRET', 'OPEN_KEY']), [
    'BETA_PASSWORD',
    'GAMMA_KEY',
    'DELTA_TOKEN',
  ]);
});

test('a bare PASS and a trailing _AUTH are secret-shaped; an AUTH elsewhere is not', () => {
  const env = ['MAIL_PASS=', 'PANEL_BASIC_AUTH=x', 'AUTH_GUARD_MODE=x', 'GOOGLE_OAUTH_ENABLED=x'];
  assert.deepEqual(unclassifiedEnvKeys(env.join('\n'), []), ['MAIL_PASS', 'PANEL_BASIC_AUTH']);
});

test('a commented-out declaration counts, CRLF too; a prose comment does not', () => {
  const env =
    '# EPSILON_PASSWORD=  # uncomment if needed\r\n#ZETA_SECRET=\r\n# the KEY rotates\r\n';
  assert.deepEqual(unclassifiedEnvKeys(env, []), ['EPSILON_PASSWORD', 'ZETA_SECRET']);
});

test('every secret-shaped name in .env.example is on a list', () => {
  const env = readFileSync(join(repoRoot, '.env.example'), 'utf8');
  assert.deepEqual(unclassifiedEnvKeys(env), []);
  // Not vacuous: the file declares dozens of secret-shaped names.
  assert.ok(unclassifiedEnvKeys(env, []).length > 20);
});

test('the public and build-time lists hold only the keys ruled onto them', () => {
  // Moving a secret onto either would silence both checks for it; that takes an edit here.
  assert.deepEqual(publicEnvKeys, [
    'SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'VAPID_PUBLIC_KEY',
  ]);
  assert.deepEqual(buildTimeEnvKeys, ['SENTRY_AUTH_TOKEN']);
});

test('the server secrets ruling 511 added are forbidden', () => {
  for (const key of [
    'POSTGRES_PASSWORD',
    'AUTHENTICATOR_PASSWORD',
    'SUPABASE_AUTH_ADMIN_PASSWORD',
    'SUPABASE_STORAGE_ADMIN_PASSWORD',
    'SUPABASE_REALTIME_DB_ENC_KEY',
    'STUDIO_PASSWORD',
    'TRAEFIK_DASHBOARD_PASSWORD',
    'TRAEFIK_DASHBOARD_AUTH',
    'STUDIO_BASIC_AUTH',
    'SMTP_PASS',
    'REDIS_PASSWORD',
    'GOOGLE_OAUTH_CLIENT_SECRET',
    'VAPID_PRIVATE_KEY',
    'BACKUP_SCW_ACCESS_KEY',
    'BACKUP_SCW_SECRET_KEY',
    'GITHUB_TOKEN',
  ]) {
    assert.deepEqual(mostSpecificMatches(`const k = process.env.${key};`), [key], key);
  }
});

test('the gate runs the .env.example check and keeps its findings', () => {
  // The tests above prove the function; this one proves the gate still calls it.
  // Whitespace is dropped on both sides so a Prettier re-wrap cannot break the match.
  const squash = (text) => text.replace(/\s+/g, '');
  const source = squash(
    readFileSync(join(repoRoot, 'scripts/check-client-secret-boundaries.mjs'), 'utf8'),
  );
  for (const call of [
    "const unclassified = unclassifiedEnvKeys(readFileSync(join(root, '.env.example'), 'utf8'));",
    'findings: [...leaks, ...unclassified.map((name) => `.env.example: ${name} is on no list',
  ]) {
    assert.ok(source.includes(squash(call)), call);
  }
  assert.deepEqual(gate.run({ argv: [] }).findings, []);
});

test('the scan reports how many files it read, not how many leaked', () => {
  // The count is what the harness checks for an empty scan, so it has to be the
  // number of files READ. Before it existed this gate printed the same clean
  // line whether it had walked three app trees or nothing at all.
  const { leaks, scanned } = scanFrontendRoots();

  assert.ok(Array.isArray(leaks));
  assert.ok(
    scanned > 100,
    `the three web app trees hold thousands of scannable files; got ${scanned}`,
  );
});
