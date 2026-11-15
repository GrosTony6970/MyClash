import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { ignoredAdvisories, lockedDirectDependencies } from './check-repo-advisories.mjs';

// What the repository-advisory check reads from the repo: the lockfile and the ignore list.

test("the lockfile's direct dependencies are read from its last document, workspace links left out", () => {
  const lock = [
    '---',
    'importers:',
    '',
    '  .:',
    '    dependencies:',
    '      pnpm:',
    '        specifier: 12.16.1',
    '        version: 12.16.1',
    '---',
    'importers:',
    '',
    '  .:',
    '    devDependencies:',
    "      '@scope/tool':",
    '        specifier: ^2.0.0',
    '        version: 2.1.0(peer@1.0.0)',
    '',
    '  apps/api:',
    '    dependencies:',
    "      '@myclash/types':",
    '        specifier: workspace:*',
    '        version: link:../../packages/types',
    '      fastify:',
    '        specifier: ^5.12.8',
    '        version: 5.12.8',
    '',
    'packages:',
  ].join('\n');
  const deps = lockedDirectDependencies(lock);
  assert.deepEqual([...deps.keys()], ['@scope/tool', 'fastify']);
  assert.deepEqual([...deps.get('@scope/tool').versions], ['2.1.0']);
  assert.deepEqual([...deps.get('fastify').importers], ['apps/api']);
  assert.throws(() => lockedDirectDependencies('---\nlockfileVersion: 9.0\n'), /no `importers:`/u);
});

test('the committed lockfile yields the direct dependencies of every workspace', () => {
  const deps = lockedDirectDependencies(
    readFileSync(join(process.cwd(), 'pnpm-lock.yaml'), 'utf8'),
  );
  assert.ok(deps.size > 50);
  assert.ok(deps.has('fastify') && deps.has('@nestjs/core') && deps.has('next'));
});

test("the ignore list is the audit's own, in each shape pnpm-workspace.yaml allows", () => {
  assert.deepEqual([...ignoredAdvisories('auditConfig:\n  ignoreGhsas: []\n')], []);
  assert.deepEqual(
    [
      ...ignoredAdvisories(
        "auditConfig:\n  ignoreGhsas: ['GHSA-aaaa-bbbb-cccc', GHSA-dddd-eeee-ffff]\n",
      ),
    ],
    ['GHSA-aaaa-bbbb-cccc', 'GHSA-dddd-eeee-ffff'],
  );
  assert.deepEqual(
    [...ignoredAdvisories('auditConfig:\n  ignoreGhsas:\n    - GHSA-aaaa-bbbb-cccc\nnext: 1\n')],
    ['GHSA-aaaa-bbbb-cccc'],
  );
  assert.throws(() => ignoredAdvisories('auditConfig:\n  ignoreGhsas: maybe\n'), /cannot read/u);
  assert.throws(() => ignoredAdvisories('overrides: {}\n'), /no `auditConfig:`/u);
  const real = readFileSync(join(process.cwd(), 'pnpm-workspace.yaml'), 'utf8');
  assert.ok(ignoredAdvisories(real) instanceof Set);
});
