import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findGaps,
  parseComposeBuildArgs,
  parseDockerfileArgs,
  parseRequiredEnv,
} from './check-client-env-contract.mjs';

// ── next.config parsing ──────────────────────────────────────────────────────

test('reads REQUIRED_PROD_ENV, deduped and sorted', () => {
  const source = `
const REQUIRED_PROD_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  // a comment mentioning NEXT_PUBLIC_SUPABASE_URL again
  'NEXT_PUBLIC_API_URL',
] as const;
`;
  assert.deepEqual(parseRequiredEnv(source), ['NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_SUPABASE_URL']);
});

test('returns null when an app declares no contract', () => {
  // web-marketing is a static Caddy site with no next.config at all; an app
  // without the list is not a failure.
  assert.equal(parseRequiredEnv('export default {};'), null);
});

test('does not pick up NEXT_PUBLIC names from outside the block', () => {
  const source = `
const OTHER = ['NEXT_PUBLIC_DECOY'];
const REQUIRED_PROD_ENV = ['NEXT_PUBLIC_API_URL'] as const;
`;
  assert.deepEqual(parseRequiredEnv(source), ['NEXT_PUBLIC_API_URL']);
});

// ── Dockerfile parsing ───────────────────────────────────────────────────────

test('reads top-level ARG declarations only', () => {
  const source = [
    'ARG NODE_VERSION=26',
    'ARG NEXT_PUBLIC_API_URL',
    'ARG NEXT_PUBLIC_SUPABASE_URL',
    'RUN echo ARG NEXT_PUBLIC_NOT_A_DECLARATION',
    'ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL',
  ].join('\n');
  assert.deepEqual([...parseDockerfileArgs(source)].sort(), [
    'NEXT_PUBLIC_API_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
  ]);
});

test('handles a Dockerfile with no client args (the API image)', () => {
  assert.equal(parseDockerfileArgs('ARG NODE_VERSION=26\nFROM node\n').size, 0);
});

// ── compose parsing ──────────────────────────────────────────────────────────

const compose = `
services:
  api:
    build:
      dockerfile: apps/api/Dockerfile
      args:
        GIT_COMMIT: abc
  web-admin:
    build:
      context: ../
      dockerfile: apps/web-admin/Dockerfile
      target: runner
      args:
        NEXT_PUBLIC_API_URL: https://admin.example
        # a comment inside the block
        NEXT_PUBLIC_SUPABASE_URL: https://sb.example
    container_name: myclash-web-admin
    environment:
      NODE_ENV: development
  web-public:
    build:
      dockerfile: apps/web-public/Dockerfile
      args:
        NEXT_PUBLIC_API_URL: https://public.example
`;

test('collects the build args of the right service', () => {
  assert.deepEqual([...parseComposeBuildArgs(compose, 'web-admin')].sort(), [
    'NEXT_PUBLIC_API_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
  ]);
});

test('stops at the next service rather than bleeding into it', () => {
  // The bug this guards: web-admin must not inherit web-public's args.
  const admin = parseComposeBuildArgs(compose, 'web-admin');
  assert.equal(admin.has('NEXT_PUBLIC_API_URL'), true);
  assert.deepEqual([...parseComposeBuildArgs(compose, 'web-public')], ['NEXT_PUBLIC_API_URL']);
});

test('does not absorb the environment block that follows args', () => {
  // `NODE_ENV` sits under `environment:`, not `build.args` — counting it would
  // hide exactly the dev-stack bug this gate exists for.
  assert.equal(parseComposeBuildArgs(compose, 'web-admin').has('NODE_ENV'), false);
});

test('returns null when no service builds that app', () => {
  assert.equal(parseComposeBuildArgs(compose, 'web-staff'), null);
});

// ── The rules ────────────────────────────────────────────────────────────────

const base = {
  app: 'web-x',
  required: ['NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_SUPABASE_URL'],
  dockerfileArgs: new Set(['NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_SUPABASE_URL']),
  prodArgs: new Set(['NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_SUPABASE_URL']),
  devArgs: new Set(['NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_SUPABASE_URL']),
};

test('a satisfied contract reports nothing', () => {
  assert.deepEqual(findGaps(base), []);
});

test('flags a missing Dockerfile ARG', () => {
  const gaps = findGaps({ ...base, dockerfileArgs: new Set(['NEXT_PUBLIC_API_URL']) });
  assert.equal(gaps.length, 1);
  assert.match(gaps[0], /declares no ARG for: NEXT_PUBLIC_SUPABASE_URL/);
});

test('flags a missing prod compose arg', () => {
  const gaps = findGaps({ ...base, prodArgs: new Set(['NEXT_PUBLIC_API_URL']) });
  assert.match(gaps[0], /prod\.yml does not pass: NEXT_PUBLIC_SUPABASE_URL/);
});

test('flags a missing dev compose arg', () => {
  // The real bug: dev builds target: runner, so it runs the same next build.
  const gaps = findGaps({ ...base, devArgs: new Set(['NEXT_PUBLIC_API_URL']) });
  assert.match(gaps[0], /dev\.yml does not pass: NEXT_PUBLIC_SUPABASE_URL/);
});

test('an app absent from the dev stack is not a gap', () => {
  assert.deepEqual(findGaps({ ...base, devArgs: null }), []);
});

test('an app absent from the PROD stack IS a gap', () => {
  // Prod is not optional — an unbuilt production image is a deploy failure.
  const gaps = findGaps({ ...base, prodArgs: null });
  assert.match(gaps[0], /no service building apps\/web-x\/Dockerfile/);
});

test('reports every layer at once rather than stopping at the first', () => {
  const gaps = findGaps({
    ...base,
    dockerfileArgs: new Set(),
    prodArgs: new Set(),
    devArgs: new Set(),
  });
  assert.equal(gaps.length, 3);
});
