#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';

import { defineGate } from './lib/gate.mjs';
import { toRepoPath, walkRepoFiles } from './lib/repo-scan.mjs';

export const REQUIRED_FILES = [
  'docs/OBSERVABILITY_REVIEW.md',
  'apps/api/src/common/observability/redaction.ts',
  'apps/api/src/common/observability/redaction.test.ts',
  'apps/api/src/common/observability/request-logging.middleware.ts',
  'apps/api/src/common/observability/request-logging.middleware.test.ts',
  'apps/api/src/common/observability/sentry.ts',
  'apps/api/src/common/observability/sentry.test.ts',
  'apps/web-admin/instrumentation-client.ts',
  'apps/web-admin/app/global-error.tsx',
  'apps/web-admin/sentry.server.config.ts',
  'apps/web-public/instrumentation-client.ts',
  'apps/web-public/app/global-error.tsx',
  'apps/web-public/sentry.server.config.ts',
  'apps/web-staff/instrumentation-client.ts',
  'apps/web-staff/app/global-error.tsx',
  'apps/web-staff/sentry.server.config.ts',
];

export const REQUIRED_ENV_KEYS = [
  'SENTRY_DSN_API',
  'NEXT_PUBLIC_SENTRY_DSN_ADMIN',
  'NEXT_PUBLIC_SENTRY_DSN_PUBLIC',
  'NEXT_PUBLIC_SENTRY_DSN_SCORING',
  'SENTRY_ENVIRONMENT',
  'SENTRY_RELEASE',
  'SENTRY_TRACES_SAMPLE_RATE',
  // Build-time source-map upload token (kept empty in the example).
  'SENTRY_AUTH_TOKEN',
];

const SENTRY_DEPENDENCIES = [
  ['apps/api/package.json', '@sentry/nestjs'],
  ['apps/web-admin/package.json', '@sentry/nextjs'],
  ['apps/web-public/package.json', '@sentry/nextjs'],
  ['apps/web-staff/package.json', '@sentry/nextjs'],
];

// Each Next app must wire Sentry source-map upload, otherwise client-side
// stack traces land in Sentry minified/unreadable. Gated on SENTRY_AUTH_TOKEN
// at build time (empty ⇒ upload skipped, build stays green).
const NEXT_CONFIGS = [
  'apps/web-public/next.config.ts',
  'apps/web-admin/next.config.ts',
  'apps/web-staff/next.config.ts',
];

const LOGGING_MIDDLEWARE = 'apps/api/src/common/observability/request-logging.middleware.ts';

/**
 * Every rule of the gate over one repository view. `exists` and `read` take a
 * repo-relative path; the test passes an in-memory tree, the gate the disk.
 * `scanned` counts the files the rules looked at.
 */
export function checkObservability({ exists, read }) {
  const findings = [];
  let scanned = 0;
  const readFile = (path) => {
    scanned += 1;
    return read(path);
  };

  for (const file of REQUIRED_FILES) {
    scanned += 1;
    if (!exists(file)) findings.push(`Missing required observability file: ${file}`);
  }

  const envExample = readFile('.env.example');
  for (const key of REQUIRED_ENV_KEYS) {
    if (!envExample.includes(`${key}=`)) findings.push(`.env.example is missing ${key}`);
  }

  const rootPackage = JSON.parse(readFile('package.json'));
  if (
    rootPackage.scripts?.['observability:review'] !== 'node scripts/check-observability-review.mjs'
  ) {
    findings.push('package.json must expose pnpm observability:review');
  }

  if (!readFile('.github/workflows/ci.yml').includes('pnpm observability:review')) {
    findings.push('CI lint job must run pnpm observability:review');
  }

  for (const [pkg, dep] of SENTRY_DEPENDENCIES) {
    const json = JSON.parse(readFile(pkg));
    if (!json.dependencies?.[dep]) findings.push(`${pkg} is missing ${dep}`);
  }

  for (const cfg of NEXT_CONFIGS) {
    if (!readFile(cfg).includes('authToken')) {
      findings.push(`${cfg} must configure Sentry source-map upload (authToken)`);
    }
  }

  const loggingSource = readFile(LOGGING_MIDDLEWARE);
  if (
    /body|password|authorization|cookie/i.test(loggingSource) &&
    !loggingSource.includes('redactHeaders')
  ) {
    findings.push('Request logging must use redaction and must not log request bodies');
  }

  return { findings, scanned };
}

// ── What may leave for Sentry (privacy policy §7.1) ─────────────────────────
// Sentry 10's "no personal data" switch still sent cookies, tokens, bodies and
// query strings. Every init now takes its setting and hooks from
// @myclash/types/sentry-data-collection; these rules hold the wiring.

export const SERVER_INITS = [
  'apps/api/src/common/observability/sentry.ts',
  'apps/web-admin/sentry.server.config.ts',
  'apps/web-public/sentry.server.config.ts',
  'apps/web-staff/sentry.server.config.ts',
];

export const BROWSER_INITS = [
  'apps/web-admin/instrumentation-client.ts',
  'apps/web-public/instrumentation-client.ts',
  'apps/web-staff/instrumentation-client.ts',
];

const HOOKS = ['beforeSend', 'beforeBreadcrumb', 'beforeSendSpan'];
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
// Built from parts so this file never holds the key shape it refuses.
const OLD_SWITCH = ['send', 'Default', 'Pii'].join('');
const OLD_SWITCH_KEY = new RegExp(`\\b${OLD_SWITCH}\\s*:`);
const TRACING_FLAG_KEY = /\b(removeTracing|excludeTracing)\s*:/;

/** The source with its comments removed, strings and templates intact. A regex
 *  would eat `//` inside `'https://…'` and hide whatever followed on the line. */
export function stripComments(source, path = 'x.ts') {
  const variant = /\.[jt]sx$/.test(path) ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard;
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, variant, source);
  let out = '';
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    const comment =
      kind === ts.SyntaxKind.SingleLineCommentTrivia ||
      kind === ts.SyntaxKind.MultiLineCommentTrivia;
    out += comment ? ' ' : scanner.getTokenText();
  }
  return out;
}

/** Rule A, one init: its own setting (never the other runtime's), streamed spans,
 *  and the three hooks from the shared factory, each as a real key. */
function initFindings(path, code, browser) {
  const own = browser ? 'SENTRY_BROWSER_DATA_COLLECTION' : 'SENTRY_DATA_COLLECTION';
  const other = browser ? 'SENTRY_DATA_COLLECTION' : 'SENTRY_BROWSER_DATA_COLLECTION';
  const found = [];
  const must = (pattern, what) => {
    if (!pattern.test(code)) found.push(`${path} must pass ${what}`);
  };
  must(new RegExp(`\\bdataCollection\\s*:\\s*${own}\\b`), `dataCollection: ${own}`);
  if (new RegExp(`\\b${other}\\b`).test(code)) found.push(`${path} must not use ${other}`);
  must(/\btraceLifecycle\s*:\s*SENTRY_TRACE_LIFECYCLE\b/, 'traceLifecycle: SENTRY_TRACE_LIFECYCLE');
  must(/\bcreateSentryScrubbers\s*\(/, 'its hooks from createSentryScrubbers(');
  for (const hook of HOOKS) {
    must(new RegExp(`\\b${hook}\\s*:\\s*scrubbers\\.${hook}\\b`), `${hook}: scrubbers.${hook}`);
  }
  if (browser)
    must(
      /\bintegrations\s*:\s*sentryBrowserIntegrations\b/,
      'integrations: sentryBrowserIntegrations',
    );
  return found;
}

/**
 * Rules A-C over one repository view. `sourcePaths` is the walk of apps/ and
 * packages/ (repo-relative), read for rule B.
 */
export function checkSentryPrivacy({ read, sourcePaths }) {
  const findings = [];
  let scanned = 0;
  for (const path of [...SERVER_INITS, ...BROWSER_INITS]) {
    scanned += 1;
    findings.push(
      ...initFindings(path, stripComments(read(path), path), BROWSER_INITS.includes(path)),
    );
  }
  for (const path of sourcePaths) {
    scanned += 1;
    const source = read(path);
    if (source.includes(OLD_SWITCH) && OLD_SWITCH_KEY.test(stripComments(source, path))) {
      findings.push(
        `${path} sets ${OLD_SWITCH}: it proved nothing on Sentry 10; use the shared dataCollection`,
      );
    }
  }
  for (const cfg of NEXT_CONFIGS) {
    scanned += 1;
    if (TRACING_FLAG_KEY.test(stripComments(read(cfg), cfg))) {
      findings.push(
        `${cfg} must not set removeTracing / excludeTracing: Sentry 11 would switch browser tracing off`,
      );
    }
  }
  return { findings, scanned };
}

/** The walk rule B reads: every source file under apps/ and packages/. */
export function listSentrySourcePaths(root = process.cwd()) {
  return ['apps', 'packages'].flatMap((dir) =>
    walkRepoFiles(join(root, dir), { extensions: SOURCE_EXTENSIONS }).map((path) =>
      toRepoPath(path, root),
    ),
  );
}

export const gate = defineGate({
  name: 'Observability review',
  entry: import.meta.url,
  run: () => {
    const read = (path) => readFileSync(path, 'utf8');
    const base = checkObservability({ exists: existsSync, read });
    const privacy = checkSentryPrivacy({ read, sourcePaths: listSentrySourcePaths() });
    return {
      findings: [...base.findings, ...privacy.findings],
      scanned: base.scanned + privacy.scanned,
      summary: 'Observability review checks passed.',
    };
  },
});
