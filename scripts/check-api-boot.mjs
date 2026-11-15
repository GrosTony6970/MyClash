import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { defineGate } from './lib/gate.mjs';

/**
 * Reads the log of the API started from the production image in CI's `Deploy migration run` job
 * (scripts/check-api-boot.sh) and says whether the start was a healthy one (rulings 778-781).
 *
 * Every test was green the day Nest 12.5 stopped the API from starting: only a real start shows
 * what a real start does. This checks the log of one:
 *
 * - Nest said "Nest application successfully started", and main.ts said "MyClash API listening
 *   on" once Fastify listened;
 * - nothing before the "listening" line was a warning or an error: a Nest WARN, ERROR or FATAL
 *   line, a Node process warning of any name (`(node:1) [DEP0…] DeprecationWarning: …`,
 *   `(node:1) [FSTDEP023] FastifyDeprecation: …`) or a pino line of level 40 or more (ruling 779:
 *   a healthy start prints none; a new one is a change someone has to read). Lines after it come
 *   from requests, which have their own logs. A library's plain console.warn line matches none of
 *   these shapes and is not read;
 * - the routes Nest mapped are the operations of the committed API client
 *   (packages/api-client/src/generated/schema.ts, kept honest by the OpenAPI drift gate), both
 *   ways (ruling 780): a controller that no longer starts, or one that starts without a client.
 *
 * Which process runs the jobs (rulings 807-809), from Redis's CLIENT LIST read while one role
 * runs alone (`--api-consumers <client list>`, `--worker <worker log> <client list>`):
 *
 * - the API holds no queue consumer and never starts the auto-lock scan;
 * - the worker holds exactly one consumer of each queue an `@Processor` in apps/api/src names
 *   (read from the source, so a new processor is counted with no edit here), and of no other; it
 *   logged its start and the auto-lock line with no warning before them, never started the API,
 *   and mapped GET /health alone.
 *
 * Imports node: modules and scripts/lib/gate.mjs only: the job runs it with no pnpm install.
 */

const STARTED = 'Nest application successfully started';
// main.ts's own line, printed once app.listen() resolved: the start ends here, not at Nest's
// init line, which comes before Fastify gets ready and listens.
const LISTENING = 'MyClash API listening on';
const ANSI = /\u001b\[[0-9;]*m/gu;
const NEST_PROBLEM = /^\[Nest\] \d+\s+-\s+.*?\s(WARN|ERROR|FATAL)\s/u;
// Node writes every process warning as `(node:<pid>) …`, whatever the warning's name (Fastify's
// are FastifyDeprecation, FastifySecurity); its `(Use \`node --trace-warnings …\`)` hint is not.
const NODE_WARNING = /^\(node:\d+\) /u;
const MAPPED = /Mapped \{([^,}]+), ([A-Z]+)\} route/gu;
// workers/worker-role.ts's line once /health listens, and MatchAutoLockService.start()'s.
const WORKER_STARTED = 'MyClash worker started';
const AUTO_LOCK = 'Auto-lock scan every 60 s';
const API_SOURCE = 'apps/api/src';
const METHODS = 'get|put|post|delete|options|head|patch|trace';

/** The log's lines before main.ts's "listening" line, and which of the two start lines came. */
export function startLines(log) {
  const lines = log.replace(ANSI, '').split(/\r?\n/u);
  const started = lines.some((line) => line.includes(STARTED));
  const listening = lines.findIndex((line) => line.includes(LISTENING));
  return {
    started,
    listening: listening !== -1,
    lines: listening === -1 ? lines : lines.slice(0, listening),
  };
}

/** A start-up line that is a warning or an error, in any of the three shapes the image prints. */
export function isStartProblem(line) {
  if (NEST_PROBLEM.test(line) || NODE_WARNING.test(line)) return true;
  if (!line.startsWith('{')) return false;
  try {
    const level = JSON.parse(line).level;
    return typeof level === 'number' && level >= 40;
  } catch {
    return false;
  }
}

/** `METHOD path` for each route Nest mapped, with `:name` written `{name}` as OpenAPI does. */
export function mappedRoutes(log) {
  const routes = new Set();
  for (const [, path, method] of log.replace(ANSI, '').matchAll(MAPPED)) {
    routes.add(`${method} ${path.replace(/:(\w+)/gu, '{$1}')}`);
  }
  return routes;
}

/** `METHOD path` for each operation in the generated client's `paths` interface. */
export function clientOperations(schema) {
  const start = schema.indexOf('export interface paths {');
  const end = schema.indexOf('\nexport ', start + 1);
  if (start === -1 || end === -1) {
    throw new Error('The API client file has no `export interface paths` block to read.');
  }
  const operations = new Set();
  let path = null;
  for (const line of schema.slice(start, end).split('\n')) {
    const key = /^ {2}'([^']+)': \{$/u.exec(line);
    if (key) {
      path = key[1];
      continue;
    }
    const method = new RegExp(`^ {4}(${METHODS}): operations\\[`, 'u').exec(line);
    if (method && path) operations.add(`${method[1].toUpperCase()} ${path}`);
  }
  return operations;
}

/** What went wrong in the start, given its log and the client's operations. */
export function apiBootFindings(log, operations) {
  const findings = [];
  const { started, listening, lines } = startLines(log);
  if (!started) findings.push(`The API never logged "${STARTED}".`);
  if (!listening) findings.push(`The API never logged "${LISTENING}".`);
  for (const line of lines.filter(isStartProblem)) {
    findings.push(`A start-up line is a warning or an error: ${line.trim()}`);
  }
  if (log.includes(AUTO_LOCK)) {
    findings.push('The API started the auto-lock scan: only the worker runs it (ruling 809).');
  }
  const mapped = mappedRoutes(log);
  const unserved = [...operations].filter((route) => !mapped.has(route)).sort();
  const undocumented = [...mapped].filter((route) => !operations.has(route)).sort();
  if (unserved.length) {
    findings.push(
      `${unserved.length} operation(s) of the API client were not mapped at start: ` +
        `${unserved.join(', ')}. A controller or module that no longer loads?`,
    );
  }
  if (undocumented.length) {
    findings.push(
      `${undocumented.length} route(s) mapped at start are not in the API client: ` +
        `${undocumented.join(', ')}. Run \`pnpm openapi:client\`. A route the client must not ` +
        'list (@ApiExcludeEndpoint) cannot pass this check: that needs an operator ruling.',
    );
  }
  return findings;
}

/** The non-test TypeScript files under `dir`, as `{ path, text }`. */
export function readSources(dir) {
  const sources = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sources.push(...readSources(path));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      sources.push({ path, text: readFileSync(path, 'utf8') });
    }
  }
  return sources;
}

/** The queue each `@Processor(…)` names, a string or an exported string constant. */
export function processorQueues(sources) {
  const constants = new Map();
  for (const { text } of sources) {
    for (const [, name, value] of text.matchAll(/export const (\w+) = '([^']+)';/gu)) {
      constants.set(name, value);
    }
  }
  const queues = new Set();
  const unresolved = [];
  for (const { path, text } of sources) {
    for (const [, argument] of text.matchAll(/@Processor\(\s*([^),]+?)\s*[,)]/gu)) {
      const value = /^'([^']+)'$/u.exec(argument)?.[1] ?? constants.get(argument);
      if (value) queues.add(value);
      else unresolved.push(`${path}: @Processor(${argument})`);
    }
  }
  return { queues: [...queues].sort(), unresolved };
}

/**
 * Consumers per queue in a Redis CLIENT LIST. A BullMQ Worker names its blocking connection
 * `bull:<base64 queue>`, with `:w:<name>` added when the Worker has a name; `:qe` names a
 * QueueEvents connection, which consumes nothing; a Queue's own connection has no name.
 */
export function consumersByQueue(clientList) {
  const counts = new Map();
  for (const [, name] of clientList.matchAll(/\bname=bull:(\S+)/gu)) {
    const [encoded, suffix] = name.split(':');
    if (suffix === 'qe') continue;
    const queue = Buffer.from(encoded, 'base64').toString('utf8');
    counts.set(queue, (counts.get(queue) ?? 0) + 1);
  }
  return counts;
}

/** The API holds 0 consumers of each queue, the worker exactly 1, and neither holds another. */
export function consumerFindings(role, counts, queues) {
  const want = role === 'worker' ? 1 : 0;
  const findings = [];
  for (const queue of queues) {
    const held = counts.get(queue) ?? 0;
    if (held !== want) {
      findings.push(`The ${role} holds ${held} consumer(s) of the queue "${queue}", not ${want}.`);
    }
  }
  for (const [queue, held] of counts) {
    if (!queues.includes(queue)) {
      findings.push(
        `The ${role} holds ${held} consumer(s) of "${queue}", a queue no @Processor in ` +
          `${API_SOURCE} names.`,
      );
    }
  }
  return findings;
}

/** What went wrong in a worker's start, given its log. */
export function workerBootFindings(log) {
  const lines = log.replace(ANSI, '').split(/\r?\n/u);
  const started = lines.findIndex((line) => line.includes(WORKER_STARTED));
  const findings = [];
  if (started === -1) findings.push(`The worker never logged "${WORKER_STARTED}".`);
  if (!log.includes(AUTO_LOCK)) findings.push('The worker never started the auto-lock scan.');
  if (log.includes(LISTENING)) findings.push(`The worker started the API ("${LISTENING}").`);
  const startUp = started === -1 ? lines : lines.slice(0, started);
  for (const line of startUp.filter(isStartProblem)) {
    findings.push(`A worker start-up line is a warning or an error: ${line.trim()}`);
  }
  const mapped = [...mappedRoutes(log)].sort();
  if (mapped.join() !== 'GET /health') {
    // The API's 751 routes would make one unreadable line: the count and the first few.
    const shown = mapped.slice(0, 5).join(', ') + (mapped.length > 5 ? ', …' : '');
    findings.push(
      `The worker maps ${mapped.length} route(s), not GET /health alone: ${shown || 'none'}.`,
    );
  }
  return findings;
}

/** The consumer check of one role, its client list read from `clientsPath`. */
function roleRun(role, clientsPath, extraFindings) {
  const { queues, unresolved } = processorQueues(readSources(API_SOURCE));
  const counts = consumersByQueue(readFileSync(clientsPath, 'utf8'));
  return {
    findings: [
      ...unresolved.map((site) => `A processor's queue could not be read: ${site}.`),
      ...(queues.length ? [] : [`No @Processor found under ${API_SOURCE}.`]),
      ...extraFindings,
      ...consumerFindings(role, counts, queues),
    ],
    scanned: queues.length,
    summary:
      role === 'worker'
        ? `The worker started, with one consumer of each of the ${queues.length} queues.`
        : `The API holds no consumer of the ${queues.length} queues.`,
    remedy:
      'Only the --worker process starts the queue consumers (workers.module.ts\n' +
      'manualRegistration, workers/worker-role.ts) and the auto-lock scan.',
  };
}

export const gate = defineGate({
  name: 'API start',
  entry: import.meta.url,
  run: ({ argv }) => {
    if (argv[0] === '--api-consumers' && argv[1]) return roleRun('api', argv[1], []);
    if (argv[0] === '--worker' && argv[1] && argv[2]) {
      return roleRun('worker', argv[2], workerBootFindings(readFileSync(argv[1], 'utf8')));
    }
    const [logPath, schemaPath] = argv;
    if (!logPath || !schemaPath) {
      return {
        findings: [
          'Usage: node scripts/check-api-boot.mjs <api log> <api client schema.ts>\n' +
            '       node scripts/check-api-boot.mjs --api-consumers <redis client list>\n' +
            '       node scripts/check-api-boot.mjs --worker <worker log> <redis client list>',
        ],
        scanned: 0,
        summary: 'No log given.',
      };
    }
    const log = readFileSync(logPath, 'utf8');
    const operations = clientOperations(readFileSync(schemaPath, 'utf8'));
    return {
      findings: apiBootFindings(log, operations),
      scanned: mappedRoutes(log).size,
      summary: `The API started with no warning and mapped the ${operations.size} operations of its client.`,
      remedy:
        'Production starts this same image. Read the start log printed above: a warning is a\n' +
        'change someone has to read, and a route missing on either side is a controller that\n' +
        'does not load or a client that was not regenerated.',
    };
  },
});
