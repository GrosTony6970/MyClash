import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import {
  BROWSER_INITS,
  REQUIRED_ENV_KEYS,
  REQUIRED_FILES,
  SERVER_INITS,
  checkObservability,
  checkSentryPrivacy,
  listSentrySourcePaths,
  stripComments,
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

// ── Rules A-C: what may leave for Sentry ────────────────────────────────────

// The refused key, built from parts so this file never holds its shape.
const OLD = ['send', 'Default', 'Pii'].join('');

const HOOK_LINES = [
  '  traceLifecycle: SENTRY_TRACE_LIFECYCLE,',
  '  beforeSend: scrubbers.beforeSend,',
  '  beforeBreadcrumb: scrubbers.beforeBreadcrumb,',
  '  beforeSendSpan: scrubbers.beforeSendSpan,',
];
const SERVER_INIT = [
  "const scrubbers = createSentryScrubbers({ ownHosts: [], runtime: 'server' });",
  "Sentry.init({ dsn: 'https://k@o.example.test/1',",
  '  dataCollection: SENTRY_DATA_COLLECTION,',
  ...HOOK_LINES,
  '});',
].join('\n');
const BROWSER_INIT = [
  "const scrubbers = createSentryScrubbers({ ownHosts: [], runtime: 'browser' });",
  'Sentry.init({',
  '  dataCollection: SENTRY_BROWSER_DATA_COLLECTION,',
  '  integrations: sentryBrowserIntegrations,',
  ...HOOK_LINES,
  '});',
].join('\n');

function privacyTree() {
  const files = new Map();
  for (const path of SERVER_INITS) files.set(path, SERVER_INIT);
  for (const path of BROWSER_INITS) files.set(path, BROWSER_INIT);
  for (const path of NEXT_CONFIGS)
    files.set(path, 'withSentryConfig(c, { authToken, silent: true })');
  files.set('apps/x/src/clean.ts', 'export const a = 1;');
  return files;
}

function checkPrivacy(files) {
  return checkSentryPrivacy({
    read: (path) => files.get(path),
    sourcePaths: [...files.keys()].filter((path) => path.startsWith('apps/x/')),
  });
}

const API = SERVER_INITS[0];
const STAFF_SERVER = 'apps/web-staff/sentry.server.config.ts';
const STAFF_BROWSER = 'apps/web-staff/instrumentation-client.ts';

test('rules A-C: a clean tree passes, and the count covers inits, sources and configs', () => {
  const { findings, scanned } = checkPrivacy(privacyTree());
  assert.deepEqual(findings, []);
  assert.equal(scanned, SERVER_INITS.length + BROWSER_INITS.length + 1 + NEXT_CONFIGS.length);
});

test('rule A: a server init holding the browser setting is refused', () => {
  const files = privacyTree();
  files.set(
    STAFF_SERVER,
    SERVER_INIT.replace('SENTRY_DATA_COLLECTION', 'SENTRY_BROWSER_DATA_COLLECTION'),
  );
  assert.deepEqual(checkPrivacy(files).findings, [
    `${STAFF_SERVER} must pass dataCollection: SENTRY_DATA_COLLECTION`,
    `${STAFF_SERVER} must not use SENTRY_BROWSER_DATA_COLLECTION`,
  ]);
});

test('rule A: beforeSendSpan does not stand in for a missing beforeSend', () => {
  const files = privacyTree();
  files.set(API, SERVER_INIT.replace('  beforeSend: scrubbers.beforeSend,\n', ''));
  assert.deepEqual(checkPrivacy(files).findings, [
    `${API} must pass beforeSend: scrubbers.beforeSend`,
  ]);
});

test('rule A: a setting present only in a comment does not count', () => {
  const files = privacyTree();
  files.set(
    API,
    SERVER_INIT.replace(
      '  dataCollection: SENTRY_DATA_COLLECTION,',
      '  // dataCollection: SENTRY_DATA_COLLECTION,',
    ),
  );
  assert.deepEqual(checkPrivacy(files).findings, [
    `${API} must pass dataCollection: SENTRY_DATA_COLLECTION`,
  ]);
});

test('rule A: a browser init without the integrations filter is refused', () => {
  const files = privacyTree();
  files.set(
    STAFF_BROWSER,
    BROWSER_INIT.replace('  integrations: sentryBrowserIntegrations,\n', ''),
  );
  assert.deepEqual(checkPrivacy(files).findings, [
    `${STAFF_BROWSER} must pass integrations: sentryBrowserIntegrations`,
  ]);
});

test('rule A: traceLifecycle must be the shared constant, not any value', () => {
  const files = privacyTree();
  files.set(API, SERVER_INIT.replace('SENTRY_TRACE_LIFECYCLE', "process.env['X']"));
  assert.deepEqual(checkPrivacy(files).findings, [
    `${API} must pass traceLifecycle: SENTRY_TRACE_LIFECYCLE`,
  ]);
});

test('rule B: the old switch back in an app file is refused, even after a URL on the same line', () => {
  const files = privacyTree();
  files.set(
    'apps/x/src/clean.ts',
    `Sentry.init({ dsn: 'https://k@o.example.test/1', ${OLD}: true });`,
  );
  assert.deepEqual(checkPrivacy(files).findings, [
    `apps/x/src/clean.ts sets ${OLD}: it proved nothing on Sentry 10; use the shared dataCollection`,
  ]);
});

test('rule B: the old switch in a comment, or named in prose, passes', () => {
  const files = privacyTree();
  files.set(
    'apps/x/src/clean.ts',
    `// ${OLD}: false\n/* ${OLD}: true */\nconst why = 'the ${OLD} option';`,
  );
  assert.deepEqual(checkPrivacy(files).findings, []);
});

test('rule C: a tracing flag back in a Next config is refused', () => {
  const files = privacyTree();
  files.set(
    NEXT_CONFIGS[1],
    'withSentryConfig(c, { authToken, bundleSizeOptimizations: { excludeTracing: true } })',
  );
  assert.deepEqual(checkPrivacy(files).findings, [
    `${NEXT_CONFIGS[1]} must not set removeTracing / excludeTracing: Sentry 11 would switch browser tracing off`,
  ]);
});

test('stripComments keeps strings and templates whole', () => {
  assert.equal(
    stripComments("const u = 'https://a.test/x'; // gone"),
    "const u = 'https://a.test/x';  ",
  );
  assert.equal(stripComments('const t = `a//b`; /* gone */ x'), 'const t = `a//b`;   x');
});

test('the real tree: rule B walks every init, and rules A-C pass', () => {
  const sourcePaths = listSentrySourcePaths();
  for (const path of [...SERVER_INITS, ...BROWSER_INITS]) {
    assert.ok(sourcePaths.includes(path), `rule B's walk misses ${path}`);
  }
  const read = (path) => readFileSync(path, 'utf8');
  assert.deepEqual(checkSentryPrivacy({ read, sourcePaths }).findings, []);
});
