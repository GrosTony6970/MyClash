import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import {
  REQUIRED_ENV_KEYS,
  REQUIRED_FILES,
  checkObservability,
} from './check-observability-review.mjs';

const SENTRY_PACKAGES = {
  'apps/api/package.json': '@sentry/nestjs',
  'apps/web-admin/package.json': '@sentry/nextjs',
  'apps/web-public/package.json': '@sentry/nextjs',
  'apps/web-staff/package.json': '@sentry/nextjs',
};

const NEXT_CONFIGS = [
  'apps/web-public/next.config.ts',
  'apps/web-admin/next.config.ts',
  'apps/web-staff/next.config.ts',
];

const LOGGING = 'apps/api/src/common/observability/request-logging.middleware.ts';

/** A tree every rule accepts. Each test breaks exactly one thing in it. */
function cleanTree() {
  const files = new Map(REQUIRED_FILES.map((path) => [path, '']));
  files.set('.env.example', REQUIRED_ENV_KEYS.map((key) => `${key}=`).join('\n'));
  files.set(
    'package.json',
    JSON.stringify({
      scripts: { 'observability:review': 'node scripts/check-observability-review.mjs' },
    }),
  );
  files.set('.github/workflows/ci.yml', 'run: pnpm observability:review');
  for (const [path, dep] of Object.entries(SENTRY_PACKAGES)) {
    files.set(path, JSON.stringify({ dependencies: { [dep]: '11.0.0' } }));
  }
  for (const path of NEXT_CONFIGS) files.set(path, 'withSentryConfig(c, { authToken })');
  files.set(LOGGING, 'const headers = redactHeaders(req.headers); // no body, no cookie');
  return files;
}

function check(files) {
  return checkObservability({
    exists: (path) => files.has(path),
    read: (path) => {
      if (!files.has(path)) throw new Error(`fixture has no ${path}`);
      return files.get(path);
    },
  });
}

test('a clean tree passes, and the count covers every file a rule looked at', () => {
  const { findings, scanned } = check(cleanTree());
  assert.deepEqual(findings, []);
  // 16 required files + .env.example + package.json + ci.yml + 4 manifests + 3 configs + logging.
  assert.equal(scanned, REQUIRED_FILES.length + 1 + 1 + 1 + 4 + 3 + 1);
});

test('a missing required file is named', () => {
  const files = cleanTree();
  files.delete('apps/web-staff/sentry.server.config.ts');
  assert.deepEqual(check(files).findings, [
    'Missing required observability file: apps/web-staff/sentry.server.config.ts',
  ]);
});

test('a missing .env.example key is named', () => {
  const files = cleanTree();
  files.set('.env.example', files.get('.env.example').replace('SENTRY_RELEASE=', ''));
  assert.deepEqual(check(files).findings, ['.env.example is missing SENTRY_RELEASE']);
});

test('the pnpm script must be the gate exactly', () => {
  const files = cleanTree();
  files.set(
    'package.json',
    JSON.stringify({
      scripts: { 'observability:review': 'node scripts/check-observability-review.mjs && true' },
    }),
  );
  assert.deepEqual(check(files).findings, ['package.json must expose pnpm observability:review']);
});

test('CI must run the gate', () => {
  const files = cleanTree();
  files.set('.github/workflows/ci.yml', 'run: pnpm lint');
  assert.deepEqual(check(files).findings, ['CI lint job must run pnpm observability:review']);
});

test('an app without its Sentry dependency is named', () => {
  const files = cleanTree();
  files.set('apps/web-public/package.json', JSON.stringify({ dependencies: {} }));
  assert.deepEqual(check(files).findings, [
    'apps/web-public/package.json is missing @sentry/nextjs',
  ]);
});

test('a Next config without source-map upload is named', () => {
  const files = cleanTree();
  files.set('apps/web-admin/next.config.ts', 'withSentryConfig(c, {})');
  assert.deepEqual(check(files).findings, [
    'apps/web-admin/next.config.ts must configure Sentry source-map upload (authToken)',
  ]);
});

test('request logging that names a body without redaction is refused', () => {
  const files = cleanTree();
  files.set(LOGGING, 'log(req.body);');
  assert.deepEqual(check(files).findings, [
    'Request logging must use redaction and must not log request bodies',
  ]);
});

test('request logging that mentions nothing sensitive passes without redaction', () => {
  const files = cleanTree();
  files.set(LOGGING, 'log(req.method, req.url);');
  assert.deepEqual(check(files).findings, []);
});

test('the real repository passes', () => {
  const { findings } = checkObservability({
    exists: existsSync,
    read: (path) => readFileSync(path, 'utf8'),
  });
  assert.deepEqual(findings, []);
});
