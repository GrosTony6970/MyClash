/**
 * The one way a cloud run of the ops agent reaches the agent door (the ops agent's design §5).
 *
 *   node .claude/skills/myclash-ops/door.mjs round <dir>
 *   node .claude/skills/myclash-ops/door.mjs act restart|start <service> <dir>
 *   node .claude/skills/myclash-ops/door.mjs act backup|renew-certs <dir>
 *
 * `round` does the whole daily round in one process, one read after another (the ops runner
 * serves one log read at a time): the health reads, whether an Event is live, then the error
 * lines of each log service. It first empties `<dir>` of an earlier run's answers and traces
 * (`clearRun`). Each 2xx answer goes to `<dir>/<name>.json`; one line per read is printed and
 * appended to `<dir>/round.txt` as it comes, then `end <how>`.
 *
 * `act` makes one repair (slice 4), then reads how it ended: a container until it has run
 * steadily, a backup until its operation is over, the certificates once Traefik is back. It prints
 * the action's line, one `after …` line, then `end <how>`, also appended to `<dir>/act.txt`. A
 * refusal (busy, deploy, read-only, a bad request) is printed and nothing is read after it.
 *
 * The key (`OPS_AGENT_KEY`) goes to DOOR_HOST only, over HTTPS, trusting Node's bundled Mozilla
 * roots plus the one Let's Encrypt staging root beside this file. The host is fixed here, not
 * read from the environment. That binds this file only: the run's shell can still read the key,
 * so the skill's rule and the cloud's network allow-list are the other limits.
 *
 * Exit codes: 0 done, 3 the door answered but stopped or refused, 4 the door could not be
 * reached, 5 too slow, 2 usage error. It never prints the key or an answer.
 */
import { appendFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
export const DOOR_ROUTES = Object.freeze([
  ...HEALTH_READS.map((route) => `GET ${route}`),
  'GET events/live',
  'GET logs/:service',
  'POST containers/:service/:action',
  'POST backups',
  'POST tls/renew',
]);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVICES_FILE = path.join(
  HERE,
  '../../../apps/api/src/modules/ops-agent/agent-log-services.ts',
);
const KEY_STORE_DOWN = 'AGENT_KEY_STORE_UNAVAILABLE';
const CODE_WORD = /^[A-Z0-9_]{1,64}$/;
/**
 * The ops runner's own refusal codes, the only lowercase ones that reach a line: any other
 * lowercase word prints as `error`, so no answer text reaches the line the run reads.
 */
const RUNNER_CODES = new Set(['ops_busy', 'deploy_running', 'read_only_mode', 'log_read_busy']);
/** Under the Bash tool's 10-minute ceiling, so the round always prints its `end` line. */
const ROUND_BUDGET_MS = 8 * 60_000;

const READ_TIMEOUT_MS = 60_000;
/** A worker action waits up to 295 s at the API (its job in flight): D8 of slice 4. */
const CONTAINER_ACTION_TIMEOUT_MS = 300_000;
const CONTAINER_POLL_MS = 10_000;
const CONTAINER_WAIT_MS = 120_000;
/** Two reads this far apart, both running, or one good read is no recovery (a crash loop). */
const CONTAINER_STEADY_MS = 30_000;
const BACKUP_POLL_MS = 15_000;
/** Seven minutes: with the 300 s action budget unused, the run stays under the 10-minute tool. */
const BACKUP_WAIT_MS = 7 * 60_000;
/** The runner restarts Traefik 3 s after it answers; give it time to be back. */
const RENEW_SETTLE_MS = 30_000;
const SERVICE_NAME = /^[a-z][a-z-]{0,40}$/;

/** The services of `AGENT_LOG_SERVICES`, read from its source: the list has one owner. */
export function logServices(source) {
  const list = /AGENT_LOG_SERVICES = \[([^\]]*)\]/.exec(source)?.[1];
  const services = [...(list ?? '').matchAll(/'([a-z][a-z-]*)'/g)].map((m) => m[1]);
  if (services.length === 0) throw new Error('AGENT_LOG_SERVICES not found');
  return services;
}

/** Every read of the round, in order: a file name and a route. */
export function roundReads(services) {
  const health = HEALTH_READS.map((route) => ({ name: route, route }));
  const containers = health.findIndex((read) => read.route === 'containers');
  return [
    ...health.slice(0, containers + 1),
    { name: 'events-live', route: 'events/live' },
    ...health.slice(containers + 1),
    ...services.map((s) => ({ name: `log-${s}`, route: `logs/${s}?errors=1&lines=200` })),
  ];
}

/** The HTTPS request for one door call. Refuses a missing key or one that is not an agent key. */
export function doorRequestOptions(
  route,
  key,
  stagingPem,
  { method = 'GET', timeout = READ_TIMEOUT_MS } = {},
) {
  if (!key?.startsWith('mca_')) throw new Error('OPS_AGENT_KEY is missing or is not an agent key');
  return {
    hostname: DOOR_HOST,
    port: 443,
    path: `/api/v1/ops-agent/${route}`,
    method,
    headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
    ca: [...tls.rootCertificates, stagingPem],
    // Set, not left to the default: NODE_TLS_REJECT_UNAUTHORIZED=0 in the environment cannot
    // turn the check off for this read.
    rejectUnauthorized: true,
    timeout,
  };
}

/** The short code word of a refusal, or null: only a code word passes, never answer text. */
function codeOf(body) {
  let code;
  try {
    code = JSON.parse(body ?? '').code;
  } catch {
    // Not problem+json (an edge's own page): the status says enough.
  }
  return CODE_WORD.test(code) || RUNNER_CODES.has(code) ? code : null;
}

/** The one line a read prints: what came back, never the answer itself. */
export function describeOutcome(route, { status, body, error }) {
  if (status === undefined) return { ok: false, line: `unreachable ${error?.code ?? 'error'}` };
  if (status >= 200 && status < 300) {
    return { ok: true, line: `${status} ${route} ${Buffer.byteLength(body ?? '')} bytes` };
  }
  if (status === 401) return { ok: false, line: '401 key refused' };
  return { ok: false, line: `${status} ${codeOf(body) ?? 'error'}` };
}

/** One HTTPS call. A call with no answer within `options.timeout` is cut and reported. */
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
  if (status === 503 && codeOf(body) === KEY_STORE_DOWN) return 'key-store-down';
  return isFirst && (status < 200 || status >= 300) ? 'door-down' : null;
}

/**
 * Empties a run's folder of what an earlier run left: every answer (`*.json`: the round's reads
 * and `act`'s `act-*.json`) and both traces. A read that fails or never runs, or a repair not made
 * this time, then leaves nothing to be read as this run's. Only those files: never the folder
 * itself, so a wrong argument cannot become a recursive delete.
 */
export async function clearRun(dir) {
  const names = await readdir(dir).catch(() => []);
  for (const name of names) {
    if (name.endsWith('.json') || name === 'round.txt' || name === 'act.txt') {
      await rm(path.join(dir, name), { force: true });
    }
  }
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

/** `act`'s arguments, or a thrown usage error before any call. */
export function parseAct([what, ...rest]) {
  if (what === 'restart' || what === 'start') {
    const [service, dir] = rest;
    if (!SERVICE_NAME.test(service ?? '') || !dir) {
      throw new Error(`usage: act ${what} <service> <dir> (a service name: ${SERVICE_NAME})`);
    }
    return { kind: 'container', action: what, service, dir };
  }
  if ((what === 'backup' || what === 'renew-certs') && rest[0] && rest.length === 1) {
    return { kind: what === 'backup' ? 'backup' : 'renew', dir: rest[0] };
  }
  throw new Error('usage: act restart|start <service> <dir> | act backup|renew-certs <dir>');
}

const parsed = (body) => {
  try {
    return JSON.parse(body ?? '');
  } catch {
    return null;
  }
};

/** What `act` reads after a container action: until it runs steadily, or the wait ends. */
async function containerAfter({ service }, { request, sleep, now }) {
  const start = now();
  let goodSince = null;
  let seen = 'unknown none';
  for (;;) {
    const answer = await request('containers', { method: 'GET', timeout: READ_TIMEOUT_MS });
    const row = parsed(answer.body)?.containers?.find?.((c) => c.service === service);
    if (row) seen = `${row.state} ${row.health ?? 'none'}`;
    const good = row?.state === 'running' && !['starting', 'unhealthy'].includes(row.health);
    if (!good) goodSince = null;
    else if (goodSince === null) goodSince = now();
    else if (now() - goodSince >= CONTAINER_STEADY_MS) return `after ${seen}`;
    if (now() - start >= CONTAINER_WAIT_MS) return `after ${seen}`;
    await sleep(CONTAINER_POLL_MS);
  }
}

/** What `act` reads after a backup it started: until its operation is no longer running. */
async function backupAfter(started, { request, sleep, now }) {
  const id = parsed(started.body)?.operation?.id;
  const start = now();
  for (;;) {
    const state = parsed(
      (await request('backups', { method: 'GET', timeout: READ_TIMEOUT_MS })).body,
    );
    if (state && state.runningOperation?.id !== id) {
      return `after ${state.lastBackup?.status ?? 'none'}`;
    }
    if (now() - start >= BACKUP_WAIT_MS) return 'after still-running';
    await sleep(BACKUP_POLL_MS);
  }
}

/** What `act` reads after a renewal: each certificate's days left, once Traefik is back. */
async function renewAfter({ request, sleep }) {
  await sleep(RENEW_SETTLE_MS);
  const certificates = parsed(
    (await request('tls', { method: 'GET', timeout: READ_TIMEOUT_MS })).body,
  )?.certificates;
  if (!Array.isArray(certificates)) return 'after unknown';
  return `after ${certificates.map((c) => `${c.host}:${c.daysUntilExpiry ?? '?'}`).join(' ')}`;
}

/**
 * One repair, then how it ended. `deps` = { request(route, { method, timeout }), save(name, body),
 * note(line), sleep(ms), now() }. Ends: `done`, `refused-<code>`, `refused`, `unreachable`.
 */
export async function runAct(act, deps) {
  const { request, save, note } = deps;
  const container = act.kind === 'container';
  const route = container
    ? `containers/${act.service}/${act.action}`
    : act.kind === 'backup'
      ? 'backups'
      : 'tls/renew';
  const label = container ? `${act.action} ${act.service}` : act.kind;
  const result = await request(route, {
    method: 'POST',
    timeout: container ? CONTAINER_ACTION_TIMEOUT_MS : READ_TIMEOUT_MS,
  });
  const outcome = describeOutcome(route, result);
  const ok = outcome.ok;
  await note(ok ? `${result.status} act ${label}` : outcome.line);
  if (ok) await save(`act-${label.replace(' ', '-')}`, result.body);
  if (result.status === undefined && !container) {
    await note('end unreachable');
    return { end: 'unreachable' };
  }
  const code = result.status === 401 ? null : codeOf(result.body);
  // On a long restart the likely cut is a gateway's 5xx, or the API's own uncoded 503: the action
  // probably ran. Only a 4xx or a coded 5xx (busy, deploy, read-only, key store) is a refusal.
  const cutOnTheWay = container && result.status >= 500 && code === null;
  if (result.status !== undefined && !ok && !cutOnTheWay) {
    const end = code ? `refused-${code}` : 'refused';
    await note(`end ${end}`);
    return { end };
  }
  // A container action cut on the way (D8) still reads what came of it.
  const after = container
    ? await containerAfter(act, deps)
    : act.kind === 'backup'
      ? await backupAfter(result, deps)
      : await renewAfter(deps);
  await note(after);
  await note('end done');
  return { end: 'done' };
}

async function main([mode, ...args]) {
  if (mode !== 'round' && mode !== 'act') {
    console.error('usage: node door.mjs round <dir> | act …');
    return 2;
  }
  let act;
  try {
    act = mode === 'act' ? parseAct(args) : null;
  } catch (err) {
    console.error(err.message);
    return 2;
  }
  const dir = mode === 'act' ? act.dir : args[0];
  if (!dir) {
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
  const trace = path.join(dir, mode === 'act' ? 'act.txt' : 'round.txt');
  // A run's repairs all come after its round: a round starts from an empty folder.
  if (mode === 'round') {
    await clearRun(dir);
    await writeFile(trace, '');
  }
  const note = async (line) => {
    console.log(line);
    await appendFile(trace, `${line}\n`);
  };
  const save = (name, body) => writeFile(path.join(dir, `${name}.json`), body);
  if (mode === 'act') {
    const { end } = await runAct(act, {
      request: (route, options) => sendDoorRequest(doorRequestOptions(route, key, pem, options)),
      save,
      note,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: Date.now,
    });
    return { done: 0, unreachable: 4 }[end] ?? 3;
  }
  const reads = roundReads(logServices(await readFile(SERVICES_FILE, 'utf8')));
  const { end } = await runRound(reads, {
    request: (route) => sendDoorRequest(doorRequestOptions(route, key, pem)),
    save,
    note,
    deadline: Date.now() + ROUND_BUDGET_MS,
  });
  await note(`end ${end}`);
  return { done: 0, unreachable: 4, slow: 5 }[end] ?? 3;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = relaunchThroughProxy() ?? (await main(process.argv.slice(2)));
}
