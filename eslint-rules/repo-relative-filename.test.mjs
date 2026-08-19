/**
 * Gate: the path a baseline is keyed by.
 *
 * Worth its own tests because both callers can fail silently. A baseline lookup
 * that never matches makes the i18n rule report violations it was told to
 * ignore; one that matches too eagerly makes the fetch ratchet exempt a file
 * nobody exempted. Neither throws, and the i18n baseline is currently empty, so
 * its own rule cannot be the thing that proves this.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { repoRelativeFilename } from './repo-relative-filename.mjs';

const CWD = '/home/runner/work/MyClash/MyClash/apps/web-admin';

test('an absolute path is cut at the apps/ boundary', () => {
  assert.equal(
    repoRelativeFilename(`${CWD}/app/admin/page.tsx`, CWD),
    'apps/web-admin/app/admin/page.tsx',
  );
});

test('a Windows absolute path lands on the same key', () => {
  assert.equal(
    repoRelativeFilename('F:\\Github Repo\\MyClash\\apps\\web-public\\src\\lib\\api-url.ts', CWD),
    'apps/web-public/src/lib/api-url.ts',
  );
});

test('a path relative to the app gets the app name back from the cwd', () => {
  // ESLint runs `eslint app src` with the cwd set to the app, so this is the
  // shape that would otherwise make app/admin/page.tsx mean three files.
  assert.equal(
    repoRelativeFilename('app/admin/page.tsx', CWD),
    'apps/web-admin/app/admin/page.tsx',
  );
  assert.equal(
    repoRelativeFilename('./src/lib/api-url.ts', CWD),
    'apps/web-admin/src/lib/api-url.ts',
  );
});

test('the same relative path under another app resolves to that app', () => {
  assert.equal(
    repoRelativeFilename('app/admin/page.tsx', '/repo/apps/web-staff'),
    'apps/web-staff/app/admin/page.tsx',
  );
});

test('a path outside apps/ is returned as-is rather than guessed at', () => {
  assert.equal(
    repoRelativeFilename('/repo/packages/ui/src/Button.tsx', '/repo/packages/ui'),
    '/repo/packages/ui/src/Button.tsx',
  );
  assert.equal(repoRelativeFilename('file.ts', '/repo'), 'file.ts');
});
