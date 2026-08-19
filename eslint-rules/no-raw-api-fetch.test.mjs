/**
 * Gate: the ratchet fires, is registered, and only ever shrinks.
 *
 * ── Why three assertions and not one ────────────────────────────────────────
 * The baseline is fully seeded, so on a clean tree this rule reports NOTHING.
 * That makes `pnpm lint` useless as evidence: a rule that is unregistered, or
 * that throws and is swallowed, and a rule that is working perfectly all look
 * identical from the outside. The firing test proves the rule works; the
 * registration test proves it is switched on in all three apps; the count test
 * proves the exemption list did not quietly grow. Drop any one of them and the
 * ratchet can fail silently — which is the failure it exists to prevent.
 *
 * Lives here rather than in a CI gate on purpose: a new gate costs four
 * registrations (package.json, ci.yml, CI_GATES, CONTRIBUTING.md), and a test
 * under the existing `pnpm test:scripts` step costs none and binds as hard.
 * See scripts/package-manifests.test.mjs, which makes the same trade.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';

import rule, { BASELINE, PERMANENTLY_EXEMPT } from './no-raw-api-fetch.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');

/**
 * The exemption count, checked in beside the list. Converting files lowers it;
 * nothing may raise it. A pull request that adds a file to the baseline has to
 * change this number too, where a reviewer sees it.
 */
const BASELINE_SIZE = 248;

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true }, ecmaVersion: 'latest', sourceType: 'module' },
  },
});

test('it flags a hand-rolled fetch, whatever shape the URL arrives in', () => {
  ruleTester.run('no-raw-api-fetch', rule, {
    valid: [
      // The seam itself.
      { code: "const r = await apiRequest(apiUrl, '/api/v1/venues', { signal });" },
      // A deliberate non-API fetch, with its reason.
      {
        code: "// raw-fetch-exempt — reads a static asset, not the API\nawait fetch('/logo.svg');",
      },
      // Something merely named like it.
      { code: "await fetchWithCache('/api/v1/matches');" },
      // An already-baselined file is silent — that is what the baseline is.
      {
        code: "await fetch('/api/v1/venues');",
        filename: [...BASELINE][0],
      },
      // The offline layer owns its fetch permanently.
      {
        code: "await fetch('/api/v1/matches');",
        filename: `${PERMANENTLY_EXEMPT[0]}sync.ts`,
      },
    ],
    invalid: [
      {
        code: "await fetch(`${apiUrl}/api/v1/venues`, { credentials: 'include' });",
        errors: [{ messageId: 'rawFetch' }],
      },
      // The bypass a URL-text rule would miss: the path is in a variable.
      {
        code: "const endpoint = `${apiUrl}/api/v1/venues`;\nconst res = await fetch(endpoint, { credentials: 'include' });",
        errors: [{ messageId: 'rawFetch' }],
      },
      // ...and the same thing spelled through the global.
      {
        code: 'await window.fetch(endpoint);',
        errors: [{ messageId: 'rawFetch' }],
      },
      // Inside JSX-bearing source, which is what the apps actually hold.
      {
        code: 'export function Panel() {\n  const load = () => fetch(url);\n  return <button onClick={load}>go</button>;\n}',
        filename: 'Panel.tsx',
        errors: [{ messageId: 'rawFetch' }],
      },
    ],
  });
});

test('it is switched on in all three web apps', () => {
  for (const app of ['web-admin', 'web-public', 'web-staff']) {
    const config = readFileSync(path.join(repoRoot, 'apps', app, 'eslint.config.mjs'), 'utf8');
    assert.match(
      config,
      /from '\.\.\/\.\.\/eslint-rules\/no-raw-api-fetch\.mjs'/,
      `${app} does not import the rule`,
    );
    assert.match(
      config,
      /'no-raw-api-fetch': noRawApiFetchRule/,
      `${app} imports the rule but does not put it in the myclash plugin`,
    );
    assert.match(
      config,
      /'myclash\/no-raw-api-fetch': 'error'/,
      `${app} registers the rule but never turns it on`,
    );
  }
});

test('the exemption list only ever shrinks', () => {
  assert.equal(
    BASELINE.size,
    BASELINE_SIZE,
    'the baseline changed size — lower the constant when you convert a file, and justify it out loud if you are raising it',
  );
});

test('every exempted file is still there', () => {
  const tracked = new Set(
    execFileSync('git', ['ls-files', '-z'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 64,
    })
      .split('\0')
      .filter(Boolean),
  );
  const dead = [...BASELINE].filter((file) => !tracked.has(file));
  assert.deepEqual(
    dead,
    [],
    'a baselined file was renamed or deleted; its exemption is now a dead line',
  );
});

test('the exemption list is sorted and free of duplicates', () => {
  const files = JSON.parse(
    readFileSync(path.join(repoRoot, 'eslint-rules', 'no-raw-api-fetch-baseline.json'), 'utf8'),
  ).files;
  assert.equal(files.length, new Set(files).size, 'the baseline holds a duplicate');
  assert.deepEqual(files, [...files].sort(), 'the baseline is not sorted');
});
