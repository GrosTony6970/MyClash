import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  apiBootFindings,
  clientOperations,
  consumerFindings,
  consumersByQueue,
  isStartProblem,
  mappedRoutes,
  processorQueues,
  readSources,
  startLines,
  workerBootFindings,
} from './check-api-boot.mjs';

const nest = (level, context, text) =>
  `[Nest] 1  - 11/15/2026, 9:00:00 AM ${level.padStart(7)} [${context}] ${text}`;
const mapped = (path, method) =>
  nest('LOG', 'RouterExplorer', `Mapped {${path}, ${method}} route +1ms`);
const STARTED = nest('LOG', 'NestApplication', 'Nest application successfully started +4ms');

// main.ts's own line, once Fastify listens: the end of the start.
const LISTENING = 'MyClash API listening on http://0.0.0.0:4000';

/** A start log: the given lines, two routes, "started", the lines `between`, "listening", then
 *  whatever follows (the requests). */
const startLog = (before = [], after = [], between = []) =>
  [
    nest('LOG', 'NestFactory', 'Starting Nest application...'),
    ...before,
    mapped('/health', 'GET'),
    mapped('/api/v1/events/:eventId', 'PATCH'),
    STARTED,
    ...between,
    '{"level":30,"msg":"Server listening at http://0.0.0.0:4000"}',
    LISTENING,
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
  assert.deepEqual(findings, [
    'The API never logged "Nest application successfully started".',
    'The API never logged "MyClash API listening on".',
  ]);
});

test('a start that never listened is reported, and its lines are all start-up lines', () => {
  const log = startLog().replace(LISTENING, '');
  const lateWarning = `${log}\n${nest('WARN', 'Probe', 'probe-marker-late')}`;
  assert.deepEqual(apiBootFindings(lateWarning, OPERATIONS), [
    'The API never logged "MyClash API listening on".',
    `A start-up line is a warning or an error: ${nest('WARN', 'Probe', 'probe-marker-late')}`,
  ]);
});

// Nest logs "started" at the end of init(); Fastify gets ready and listens after it.
test('a warning between Nest\'s "started" line and the listening line is a start-up line', () => {
  const between = ['(node:1) [FSTDEP023] FastifyDeprecation: probe-marker-listen'];
  assert.deepEqual(apiBootFindings(startLog([], [], between), OPERATIONS), [
    `A start-up line is a warning or an error: ${between[0]}`,
  ]);
});

test('a warning or an error before the start is reported, in each shape the image prints', () => {
  const before = [
    nest('WARN', 'LegacyRouteConverter', 'Unsupported route path: "/api/v1/*".'),
    // Nest colours its level when the terminal allows it.
    `\u001b[33m${nest('WARN', 'Probe', 'coloured')}\u001b[39m`,
    nest('ERROR', 'ExceptionHandler', 'probe-marker-error'),
    '(node:1) [DEP0205] DeprecationWarning: probe-marker-deprecated',
    '(node:1) ExperimentalWarning: probe-marker-experimental',
    // Fastify names its own warnings without "Warning" (lib/warnings.js).
    '(node:1) [FSTDEP023] FastifyDeprecation: probe-marker-fastify',
    '(node:1) [FSTSEC001] FastifySecurity: probe-marker-fastify-security',
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
    // Node's hint after a warning: not a warning of its own.
    '(Use `node --trace-warnings ...` to show where the warning was created)',
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

// ── Which process runs the jobs (rulings 807-809) ─────────────────────────────

const b64 = (queue) => Buffer.from(queue, 'utf8').toString('base64');
/** A CLIENT LIST line, as Redis prints it. */
const client = (id, name) =>
  `id=${id} addr=172.18.0.9:4${id} laddr=172.18.0.3:6379 fd=9 name=${name} age=3 idle=0 cmd=blpop`;

test('consumers are counted per queue from the blocking connections BullMQ names', () => {
  const list = [
    client(1, `bull:${b64('photo-cleanup')}`),
    client(2, `bull:${b64('photo-cleanup')}:w:named`),
    client(3, `bull:${b64('photo-cleanup')}:qe`),
    client(4, ''),
    'id=5 addr=172.18.0.9:45 name= cmd=client|list',
    client(6, `bull:${b64('event-archive')}`),
  ].join('\n');
  assert.deepEqual(
    [...consumersByQueue(list)],
    [
      ['photo-cleanup', 2],
      ['event-archive', 1],
    ],
  );
});

test('the API must hold no consumer, the worker exactly one per queue and no other', () => {
  const queues = ['event-archive', 'photo-cleanup'];
  assert.deepEqual(consumerFindings('api', new Map(), queues), []);
  assert.deepEqual(consumerFindings('api', new Map([['photo-cleanup', 1]]), queues), [
    'The api holds 1 consumer(s) of the queue "photo-cleanup", not 0.',
  ]);
  const one = new Map([
    ['event-archive', 1],
    ['photo-cleanup', 1],
  ]);
  assert.deepEqual(consumerFindings('worker', one, queues), []);
  assert.deepEqual(
    consumerFindings(
      'worker',
      new Map([
        ['event-archive', 2],
        ['probe-marker-queue', 1],
      ]),
      queues,
    ),
    [
      'The worker holds 2 consumer(s) of the queue "event-archive", not 1.',
      'The worker holds 0 consumer(s) of the queue "photo-cleanup", not 1.',
      'The worker holds 1 consumer(s) of "probe-marker-queue", a queue no @Processor in apps/api/src names.',
    ],
  );
});

test("a processor's queue is read from a string or an exported constant, and a miss is named", () => {
  const sources = [
    { path: 'a.ts', text: "export const A_QUEUE = 'queue-a';\n@Processor(A_QUEUE)\nclass A {}" },
    { path: 'b.ts', text: "@Processor('queue-b', { concurrency: 2 })\nclass B {}" },
    { path: 'c.ts', text: '@Processor(MISSING_QUEUE)\nclass C {}' },
  ];
  assert.deepEqual(processorQueues(sources), {
    queues: ['queue-a', 'queue-b'],
    unresolved: ['c.ts: @Processor(MISSING_QUEUE)'],
  });
});

// The real source: every processor resolves, and the ten queues of today are all there.
test("the API's source names ten processor queues, every one resolved", () => {
  const { queues, unresolved } = processorQueues(
    readSources(join(process.cwd(), 'apps', 'api', 'src')),
  );
  assert.deepEqual(unresolved, []);
  assert.equal(queues.length, 10);
  assert.ok(queues.includes('notification-scheduler'));
  assert.ok(queues.includes('runtime-health-monitor'));
});

const WORKER_LINE =
  'MyClash worker started: the queue consumers and the auto-lock run here; /health on 127.0.0.1:4000';
const workerLog = (before = [], after = []) =>
  [
    nest('LOG', 'MatchAutoLockService', 'Auto-lock scan every 60 s'),
    ...before,
    mapped('/health', 'GET'),
    STARTED,
    WORKER_LINE,
    ...after,
  ].join('\n');

test("a worker's clean start: its line, the auto-lock, GET /health alone, no warning", () => {
  assert.deepEqual(workerBootFindings(workerLog()), []);
  // A job's warning after the start belongs to the job.
  assert.deepEqual(workerBootFindings(workerLog([], [nest('WARN', 'Job', 'probe-marker')])), []);
});

test("a worker's start is red when it serves the API, skips its jobs or warns", () => {
  const asApi = [mapped('/api/v1/version', 'GET'), STARTED, LISTENING].join('\n');
  assert.deepEqual(workerBootFindings(asApi), [
    'The worker never logged "MyClash worker started".',
    'The worker never started the auto-lock scan.',
    'The worker started the API ("MyClash API listening on").',
    'The worker maps 1 route(s), not GET /health alone: GET /api/v1/version.',
  ]);
  const many = Array.from({ length: 7 }, (_, i) => mapped(`/api/v1/r${i}`, 'GET')).join('\n');
  assert.ok(
    workerBootFindings(many).includes(
      'The worker maps 7 route(s), not GET /health alone: GET /api/v1/r0, GET /api/v1/r1, ' +
        'GET /api/v1/r2, GET /api/v1/r3, GET /api/v1/r4, ….',
    ),
  );
  const warned = workerLog([nest('WARN', 'Probe', 'probe-marker-early')]);
  assert.deepEqual(workerBootFindings(warned), [
    `A worker start-up line is a warning or an error: ${nest('WARN', 'Probe', 'probe-marker-early')}`,
  ]);
});

test('the API is red when it starts the auto-lock scan', () => {
  const log = startLog([nest('LOG', 'MatchAutoLockService', 'Auto-lock scan every 60 s')]);
  assert.deepEqual(apiBootFindings(log, OPERATIONS), [
    'The API started the auto-lock scan: only the worker runs it (ruling 809).',
  ]);
});
