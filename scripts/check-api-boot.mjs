import { readFileSync } from 'node:fs';

import { defineGate } from './lib/gate.mjs';

/**
 * Reads the log of the API started from the production image in CI's `Deploy migration run` job
 * (scripts/check-api-boot.sh) and says whether the start was a healthy one (rulings 778-781).
 *
 * Every test was green the day Nest 12.5 stopped the API from starting: only a real start shows
 * what a real start does. This checks the log of one:
 *
 * - Nest said "Nest application successfully started";
 * - nothing before that line was a warning or an error: a Nest WARN, ERROR or FATAL line, a Node
 *   process warning (`(node:1) [DEP0…] DeprecationWarning: …`) or a pino line of level 40 or more
 *   (ruling 779: a healthy start prints none; a new one is a change someone has to read). Lines
 *   after it come from requests, which have their own logs;
 * - the routes Nest mapped are the operations of the committed API client
 *   (packages/api-client/src/generated/schema.ts, kept honest by the OpenAPI drift gate), both
 *   ways (ruling 780): a controller that no longer starts, or one that starts without a client.
 *
 * Imports node: modules and scripts/lib/gate.mjs only: the job runs it with no pnpm install.
 */

const STARTED = 'Nest application successfully started';
const ANSI = /\u001b\[[0-9;]*m/gu;
const NEST_PROBLEM = /^\[Nest\] \d+\s+-\s+.*?\s(WARN|ERROR|FATAL)\s/u;
const NODE_WARNING = /^\(node:\d+\) .*Warning:/u;
const MAPPED = /Mapped \{([^,}]+), ([A-Z]+)\} route/gu;
const METHODS = 'get|put|post|delete|options|head|patch|trace';

/** The log's lines before Nest's "started" line, and whether that line came at all. */
export function startLines(log) {
  const lines = log.replace(ANSI, '').split(/\r?\n/u);
  const started = lines.findIndex((line) => line.includes(STARTED));
  return { started: started !== -1, lines: started === -1 ? lines : lines.slice(0, started) };
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
  const { started, lines } = startLines(log);
  if (!started) findings.push(`The API never logged "${STARTED}".`);
  for (const line of lines.filter(isStartProblem)) {
    findings.push(`A start-up line is a warning or an error: ${line.trim()}`);
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
        `${undocumented.join(', ')}. Run \`pnpm openapi:client\`, or the route carries ` +
        '@ApiExcludeEndpoint().',
    );
  }
  return findings;
}

export const gate = defineGate({
  name: 'API start',
  entry: import.meta.url,
  run: ({ argv }) => {
    const [logPath, schemaPath] = argv;
    if (!logPath || !schemaPath) {
      return {
        findings: ['Usage: node scripts/check-api-boot.mjs <api log> <api client schema.ts>'],
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
