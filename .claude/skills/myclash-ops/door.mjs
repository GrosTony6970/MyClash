/**
 * The one way a cloud run of the ops agent reads the agent door (the ops agent's design §5).
 *
 *   node .claude/skills/myclash-ops/door.mjs round <dir>
 *
 * It does the whole daily round in one process, one read after another (the ops runner holds a
 * whole log in memory and caps nothing): the six health reads, then the error lines of each log
 * service. Each 2xx answer goes to `<dir>/<name>.json`; one line per read is printed and appended
 * to `<dir>/round.txt` as it comes, then `end <how>`. The key (`OPS_AGENT_KEY`) goes to DOOR_HOST
 * only, over HTTPS, trusting Node's bundled Mozilla roots plus the one Let's Encrypt staging root
 * beside this file. The host is fixed here, not read from the environment. That binds this file
 * only: the run's shell can still read the key, so the skill's rule and the cloud's network
 * allow-list are the other limits.
 *
 * The round stops when the door cannot be reached, refuses the key, cannot read its key table,
 * has no API behind it, or runs past its budget. Exit codes: 0 the round ran, 3 the door
 * answered but the round stopped, 4 the door could not be reached, 5 too slow, 2 usage error.
 * It never prints the key or an answer.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import tls from 'node:tls';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { relaunchThroughProxy } from './env-proxy.mjs';

export const DOOR_HOST = 'app.myclash.fr';

/** The health reads of the round, in order. */
export const HEALTH_READS = Object.freeze([
  'versions',
  'runtime-health',
  'containers',
  'backups',
  'tls',
  'host',
]);

/** The door's routes, as `ops-agent.controller.ts` declares them (a test holds the two equal). */
export const DOOR_ROUTES = Object.freeze([...HEALTH_READS, 'events/live', 'logs/:service']);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVICES_FILE = path.join(
  HERE,
  '../../../apps/api/src/modules/ops-agent/agent-log-services.ts',
);
const KEY_STORE_DOWN = 'AGENT_KEY_STORE_UNAVAILABLE';
const CODE_WORD = /^[A-Z0-9_]{1,64}$/;
/** Under the Bash tool's 10-minute ceiling, so the round always prints its `end` line. */
const ROUND_BUDGET_MS = 8 * 60_000;

/** The services of `AGENT_LOG_SERVICES`, read from its source: the list has one owner. */
export function logServices(source) {
  const list = /AGENT_LOG_SERVICES = \[([^\]]*)\]/.exec(source)?.[1];
  const services = [...(list ?? '').matchAll(/'([a-z][a-z-]*)'/g)].map((m) => m[1]);
  if (services.length === 0) throw new Error('AGENT_LOG_SERVICES not found');
  return services;
}

/** Every read of the round, in order: a file name and a route. */
export function roundReads(services) {
  return [
    ...HEALTH_READS.map((route) => ({ name: route, route })),
    ...services.map((s) => ({ name: `log-${s}`, route: `logs/${s}?errors=1&lines=200` })),
  ];
}

/** The HTTPS request for one door read. Refuses a missing key or one that is not an agent key. */
export function doorRequestOptions(route, key, stagingPem) {
  if (!key?.startsWith('mca_')) throw new Error('OPS_AGENT_KEY is missing or is not an agent key');
  return {
    hostname: DOOR_HOST,
    port: 443,
    path: `/api/v1/ops-agent/${route}`,
    method: 'GET',
    headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
    ca: [...tls.rootCertificates, stagingPem],
    // Set, not left to the default: NODE_TLS_REJECT_UNAUTHORIZED=0 in the environment cannot
    // turn the check off for this read.
    rejectUnauthorized: true,
    timeout: 60_000,
  };
}

/** The one line a read prints: what came back, never the answer itself. */
export function describeOutcome(route, { status, body, error }) {
  if (status === undefined) return { ok: false, line: `unreachable ${error?.code ?? 'error'}` };
  if (status >= 200 && status < 300) {
    return { ok: true, line: `${status} ${route} ${Buffer.byteLength(body ?? '')} bytes` };
  }
  if (status === 401) return { ok: false, line: '401 key refused' };
  let code;
  try {
    code = JSON.parse(body ?? '').code;
  } catch {
    // Not problem+json (an edge's own page): the status says enough.
  }
  // Only a short code word passes: no text of the answer reaches the line the run reads.
  return { ok: false, line: `${status} ${CODE_WORD.test(code) ? code : 'error'}` };
}

/** One HTTPS read. A read with no answer within `options.timeout` is cut and reported. */
export function sendDoorRequest(options) {
  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('timeout', () =>
      req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })),
    );
    req.on('error', (error) => resolve({ error }));
    req.end();
  });
}

/**
 * Why the round must stop after this read, or null. The first read answering anything but 2xx
 * means no API stands behind the door: with the api container stopped, Traefik drops its router
 * and `app.` answers with the public site's 404 page.
 */
function stopReason({ status, body }, isFirst) {
  if (status === undefined) return 'unreachable';
  if (status === 401) return 'refused';
  if (status === 503 && describeOutcome('', { status, body }).line === `503 ${KEY_STORE_DOWN}`) {
    return 'key-store-down';
  }
  return isFirst && (status < 200 || status >= 300) ? 'door-down' : null;
}

/**
 * Runs the reads one after another. `request(route)` answers one read; `save(name, body)` keeps a
 * 2xx answer; `note(line)` records each line as it comes, so a round cut short still leaves its
 * trace. Past `deadline` the round stops. Ends: `done`, `unreachable`, `refused`,
 * `key-store-down`, `door-down`, `slow`.
 */
export async function runRound(
  reads,
  { request, save, note, deadline = Infinity, now = Date.now },
) {
  const lines = [];
  for (const [index, { name, route }] of reads.entries()) {
    const result = await request(route);
    const outcome = describeOutcome(route, result);
    if (outcome.ok) await save(name, result.body);
    lines.push(outcome.line);
    await note(outcome.line);
    const end = stopReason(result, index === 0);
    if (end) return { lines, end };
    if (index < reads.length - 1 && now() > deadline) return { lines, end: 'slow' };
  }
  return { lines, end: 'done' };
}

async function main([mode, dir]) {
  if (mode !== 'round' || !dir) {
    console.error('usage: node door.mjs round <dir>');
    return 2;
  }
  const pem = await readFile(path.join(HERE, 'staging-root.pem'), 'utf8');
  const key = process.env.OPS_AGENT_KEY;
  try {
    doorRequestOptions('versions', key, pem);
  } catch (err) {
    console.error(err.message);
    return 2;
  }
  await mkdir(dir, { recursive: true });
  const trace = path.join(dir, 'round.txt');
  await writeFile(trace, '');
  const note = async (line) => {
    console.log(line);
    await appendFile(trace, `${line}\n`);
  };
  const reads = roundReads(logServices(await readFile(SERVICES_FILE, 'utf8')));
  const { end } = await runRound(reads, {
    request: (route) => sendDoorRequest(doorRequestOptions(route, key, pem)),
    save: (name, body) => writeFile(path.join(dir, `${name}.json`), body),
    note,
    deadline: Date.now() + ROUND_BUDGET_MS,
  });
  await note(`end ${end}`);
  return { done: 0, unreachable: 4, slow: 5 }[end] ?? 3;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = relaunchThroughProxy() ?? (await main(process.argv.slice(2)));
}
