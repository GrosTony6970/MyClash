import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  apiBootFindings,
  clientOperations,
  isStartProblem,
  mappedRoutes,
  startLines,
} from './check-api-boot.mjs';

const nest = (level, context, text) =>
  `[Nest] 1  - 11/15/2026, 9:00:00 AM ${level.padStart(7)} [${context}] ${text}`;
const mapped = (path, method) =>
  nest('LOG', 'RouterExplorer', `Mapped {${path}, ${method}} route +1ms`);
const STARTED = nest('LOG', 'NestApplication', 'Nest application successfully started +4ms');

/** A start log: the given lines, two routes, then the "started" line and whatever follows. */
const startLog = (before = [], after = []) =>
  [
    nest('LOG', 'NestFactory', 'Starting Nest application...'),
    ...before,
    mapped('/health', 'GET'),
    mapped('/api/v1/events/:eventId', 'PATCH'),
    STARTED,
    ...after,
  ].join('\n');

const OPERATIONS = new Set(['GET /health', 'PATCH /api/v1/events/{eventId}']);

test('a start with no warning that mapped every operation is clean', () => {
  assert.deepEqual(apiBootFindings(startLog(), OPERATIONS), []);
});

test('a start that never finished is reported', () => {
  const log = [
    nest('LOG', 'NestFactory', 'Starting Nest application...'),
    mapped('/health', 'GET'),
  ];
  const findings = apiBootFindings(log.join('\n'), new Set(['GET /health']));
  assert.deepEqual(findings, ['The API never logged "Nest application successfully started".']);
});

test('a warning or an error before the start is reported, in each shape the image prints', () => {
  const before = [
    nest('WARN', 'LegacyRouteConverter', 'Unsupported route path: "/api/v1/*".'),
    // Nest colours its level when the terminal allows it.
    `\u001b[33m${nest('WARN', 'Probe', 'coloured')}\u001b[39m`,
    nest('ERROR', 'ExceptionHandler', 'probe-marker-error'),
    '(node:1) [DEP0205] DeprecationWarning: probe-marker-deprecated',
    '(node:1) ExperimentalWarning: probe-marker-experimental',
    '{"level":40,"msg":"probe-marker-pino-warn"}',
    '{"level":50,"msg":"probe-marker-pino-error"}',
  ];
  const findings = apiBootFindings(startLog(before), OPERATIONS);
  assert.equal(findings.length, before.length);
  assert.ok(findings.every((finding) => finding.startsWith('A start-up line is a warning')));
});

test('ordinary start lines and lines written after the start are not', () => {
  const before = [
    nest('LOG', 'InstanceLoader', 'AppModule dependencies initialized'),
    '{"level":30,"msg":"listening"}',
  ];
  const after = [
    nest('WARN', 'AuthGuard', 'auth-shadow would-401'),
    '{"level":50,"msg":"a request failed"}',
  ];
  assert.deepEqual(apiBootFindings(startLog(before, after), OPERATIONS), []);
  assert.equal(isStartProblem('{"level":"info","event":"http_request"}'), false);
  assert.equal(isStartProblem('{not json'), false);
});

test('a route missing on either side is reported, the path parameters compared as OpenAPI writes them', () => {
  const findings = apiBootFindings(
    startLog(),
    new Set(['GET /health', 'DELETE /api/v1/events/{eventId}']),
  );
  assert.equal(findings.length, 2);
  assert.match(
    findings[0],
    /^1 operation\(s\) of the API client were not mapped at start: DELETE \/api\/v1\/events\/\{eventId\}\./u,
  );
  assert.match(
    findings[1],
    /^1 route\(s\) mapped at start are not in the API client: PATCH \/api\/v1\/events\/\{eventId\}\./u,
  );
  assert.deepEqual(
    [...mappedRoutes(startLog())],
    ['GET /health', 'PATCH /api/v1/events/{eventId}'],
  );
  assert.equal(startLines(startLog()).started, true);
});

test('the client operations are read from the paths block, a method typed `never` left out', () => {
  const schema = [
    'export interface paths {',
    "  '/health': {",
    '    parameters: { query?: never };',
    "    get: operations['HealthController_getHealth'];",
    '    put?: never;',
    '  };',
    "  '/api/v1/events/{eventId}': {",
    "    patch: operations['EventsController_update'];",
    "    delete: operations['EventsController_remove'];",
    '  };',
    '}',
    'export type webhooks = Record<string, never>;',
    'export interface operations {',
    "    get: operations['NotAPath'];",
    '}',
  ].join('\n');
  assert.deepEqual(
    [...clientOperations(schema)],
    ['GET /health', 'PATCH /api/v1/events/{eventId}', 'DELETE /api/v1/events/{eventId}'],
  );
  assert.throws(
    () => clientOperations('export interface components {}'),
    /no `export interface paths`/u,
  );
});

// The committed client is what CI compares with: a change of its format must not read as zero
// operations, which would turn every mapped route into a finding or, worse, pass on nothing.
test('the committed API client yields one operation per `operations[...]` line of its paths block', () => {
  const schema = readFileSync(
    join(process.cwd(), 'packages', 'api-client', 'src', 'generated', 'schema.ts'),
    'utf8',
  );
  const paths = schema.slice(
    schema.indexOf('export interface paths {'),
    schema.indexOf('\nexport type webhooks'),
  );
  const expected =
    paths.match(/^ {4}(get|put|post|delete|options|head|patch|trace): operations\[/gmu) ?? [];
  assert.ok(expected.length > 100);
  assert.equal(clientOperations(schema).size, expected.length);
});
