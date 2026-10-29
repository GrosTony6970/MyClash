#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';

import { defineGate } from './lib/gate.mjs';

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

export const gate = defineGate({
  name: 'Observability review',
  entry: import.meta.url,
  run: () => {
    const { findings, scanned } = checkObservability({
      exists: existsSync,
      read: (path) => readFileSync(path, 'utf8'),
    });
    return { findings, scanned, summary: 'Observability review checks passed.' };
  },
});
