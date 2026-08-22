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

import rule, { BASELINE, baselineTotal, PERMANENTLY_EXEMPT } from './no-raw-api-fetch.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');

/**
 * What the exemption list still permits, checked in beside it. Converting a
 * CALL lowers the total; nothing may raise it. Both numbers are here because a
 * file count alone would not move when a converted file keeps one last fetch —
 * and would not move either when a listed file grows one.
 */
const BASELINE_FILES = 202;
const BASELINE_CALLS = 703;

/** A real baseline entry still carrying exactly two calls, for the tests below. */
const TWO_CALL_FILE = [...BASELINE.entries()].find(([, allowed]) => allowed === 2)?.[0];
if (!TWO_CALL_FILE) throw new Error('no baselined file carries exactly two calls');

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
      // A baselined file stays silent for the calls it was already carrying.
      {
        code: "await fetch('/api/v1/a');\nawait fetch('/api/v1/b');",
        filename: TWO_CALL_FILE,
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
      // The one this rule exists for: number 868, added to a file already on
      // the list. A file-level allowlist would have said nothing at all.
      {
        code: "await fetch('/api/v1/a');\nawait fetch('/api/v1/b');\nawait fetch('/api/v1/c');",
        filename: TWO_CALL_FILE,
        errors: [{ messageId: 'overBaseline', line: 3 }],
      },
      // An exempted call does not spend the allowance, so the last one is over.
      {
        code:
          "// raw-fetch-exempt — a static asset\nawait fetch('/logo.svg');\n" +
          "await fetch('/api/v1/a');\nawait fetch('/api/v1/b');\nawait fetch('/api/v1/c');",
        filename: TWO_CALL_FILE,
        errors: [{ messageId: 'overBaseline', line: 5 }],
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
    BASELINE_FILES,
    'the baseline lists a different number of files — lower the constant when you convert one, and justify it out loud if you are raising it',
  );
  assert.equal(
    baselineTotal(),
    BASELINE_CALLS,
    'the baseline permits a different number of hand-rolled calls — lower the constant when you convert one, and justify it out loud if you are raising it',
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
  const dead = [...BASELINE.keys()].filter((file) => !tracked.has(file));
  assert.deepEqual(
    dead,
    [],
    'a baselined file was renamed or deleted; its exemption is now a dead line',
  );
});

test('the rule only tells you to import from somewhere that exists', () => {
  // The rule told people to get `failureMessage` from '@/lib/api-failure' from
  // the moment 2da7927e moved the mapper into @myclash/api-client and deleted
  // that module. Nothing noticed: the firing tests above match on `messageId`
  // and never read the sentence, and a lint message is the only instruction
  // most callers of this rule will ever get.
  //
  // Matched by the SHAPE of a specifier, never by pairing quotes. The rawFetch
  // message opens with "Don't", and that lone apostrophe desynchronises every
  // quote after it — the first version of this test paired quotes, read only
  // the overBaseline message as a result, and stayed green against exactly the
  // defect it was written for.
  const specifiers = new Set();
  for (const [messageId, message] of Object.entries(rule.meta.messages)) {
    const named = [...message.matchAll(/@(?:myclash\/[\w-]+|\/[\w./-]+)/gu)].map(([m]) => m);
    // Per message, not pooled: a Set of both would be satisfied by one message
    // naming the package twice while the other named nothing at all.
    assert.ok(
      named.length > 0,
      `the "${messageId}" message names no module — it has stopped saying where to import from`,
    );
    for (const specifier of named) specifiers.add(specifier);
  }

  const workspacePackages = new Set(
    execFileSync('git', ['ls-files', 'packages/*/package.json'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean)
      .map((manifest) => JSON.parse(readFileSync(path.join(repoRoot, manifest), 'utf8')).name),
  );

  const dangling = [...specifiers].filter((specifier) => !workspacePackages.has(specifier));
  assert.deepEqual(
    dangling,
    [],
    'the rule names a module that is not a workspace package; an app-relative "@/" path cannot be one, and this rule is read from three different apps',
  );
});

test('the exemption list is sorted, and every allowance is a positive count', () => {
  const files = JSON.parse(
    readFileSync(path.join(repoRoot, 'eslint-rules', 'no-raw-api-fetch-baseline.json'), 'utf8'),
  ).files;
  const paths = Object.keys(files);
  assert.deepEqual(paths, [...paths].sort(), 'the baseline is not sorted');
  const wrong = Object.entries(files).filter(
    ([, allowed]) => !Number.isInteger(allowed) || allowed < 1,
  );
  assert.deepEqual(wrong, [], 'an allowance is not a positive whole number of calls');
});
