#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';

const requiredFiles = [
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
  'apps/web-scoring/instrumentation-client.ts',
  'apps/web-scoring/app/global-error.tsx',
  'apps/web-scoring/sentry.server.config.ts',
];

const requiredEnvKeys = [
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

const failures = [];

for (const file of requiredFiles) {
  if (!existsSync(file)) failures.push(`Missing required observability file: ${file}`);
}

const envExample = readFileSync('.env.example', 'utf8');
for (const key of requiredEnvKeys) {
  if (!envExample.includes(`${key}=`)) failures.push(`.env.example is missing ${key}`);
}

const rootPackage = JSON.parse(readFileSync('package.json', 'utf8'));
if (
  rootPackage.scripts?.['observability:review'] !== 'node scripts/check-observability-review.mjs'
) {
  failures.push('package.json must expose pnpm observability:review');
}

const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
if (!ci.includes('pnpm observability:review')) {
  failures.push('CI lint job must run pnpm observability:review');
}

for (const [pkg, dep] of [
  ['apps/api/package.json', '@sentry/nestjs'],
  ['apps/web-admin/package.json', '@sentry/nextjs'],
  ['apps/web-public/package.json', '@sentry/nextjs'],
  ['apps/web-scoring/package.json', '@sentry/nextjs'],
]) {
  const json = JSON.parse(readFileSync(pkg, 'utf8'));
  if (!json.dependencies?.[dep]) failures.push(`${pkg} is missing ${dep}`);
}

// Each Next app must wire Sentry source-map upload, otherwise client-side
// stack traces land in Sentry minified/unreadable. Gated on SENTRY_AUTH_TOKEN
// at build time (empty ⇒ upload skipped, build stays green).
for (const cfg of [
  'apps/web-public/next.config.ts',
  'apps/web-admin/next.config.ts',
  'apps/web-scoring/next.config.ts',
]) {
  const source = readFileSync(cfg, 'utf8');
  if (!source.includes('authToken')) {
    failures.push(`${cfg} must configure Sentry source-map upload (authToken)`);
  }
}

const loggingSource = readFileSync(
  'apps/api/src/common/observability/request-logging.middleware.ts',
  'utf8',
);
if (
  /body|password|authorization|cookie/i.test(loggingSource) &&
  !loggingSource.includes('redactHeaders')
) {
  failures.push('Request logging must use redaction and must not log request bodies');
}

if (failures.length > 0) {
  console.error(
    ['Observability review failed:', ...failures.map((failure) => `- ${failure}`)].join('\n'),
  );
  process.exitCode = 1;
} else {
  console.log('Observability review checks passed.');
}
