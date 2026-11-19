/**
 * The ops agent's two container reads (the ops agent's design, sections 2 and 3): the state of
 * every container, and the last lines of one container's log. `server.mjs` routes here; the API's
 * door (`apps/api/src/modules/ops-agent`) scrubs every line before the agent sees it.
 *
 * The runner cuts and the API scrubs, so a cut must never split a secret: a line cut inside an
 * address no longer matches the API's email pattern. A cut line drops its last partial word.
 */
import { refusal } from './upload-store.mjs';

/**
 * The log list (ruling 869): every compose service but the two in `LOG_EXCLUDED`. Mirrored by the
 * API (`AGENT_LOG_SERVICES`, `apps/api/src/modules/ops-agent/agent-log-services.ts`); the test
 * holds the two equal, and holds both lists against the compose file.
 */
export const LOG_SERVICES = new Set([
  'traefik',
  'redis',
  'supabase-auth',
  'supabase-realtime',
  'supabase-storage',
  'supabase-rest',
  'supabase-studio',
  'api',
  'ops-runner',
  'worker',
  'web-public',
  'web-marketing',
  'web-staff',
  'web-admin',
]);

/**
 * Never readable by the agent. `db`: its log can carry the values of a SQL statement (the design,
 * section 2). `supabase-meta`: it logs a failed query's Postgres error with its DETAIL, and
 * "Failing row contains (…)" is a whole row, a birth date included. A scrub cannot find a date.
 */
export const LOG_EXCLUDED = new Set(['db', 'supabase-meta']);

/** `status.sh`'s warn/error filter (`errors_only_filter`), word for word. */
export const PROBLEM_LINE =
  /"level":(40|50|60)|[Ee][Rr][Rr][Oo][Rr]|[Ww][Aa][Rr][Nn]|[Ff][Aa][Tt][Aa][Ll]/;

export const LOG_LINES_DEFAULT = 100;
export const LOG_LINES_MAX = 500;
export const LOG_LINE_MAX_CHARS = 2000;
/** The whole answer's line text, in characters. */
export const LOG_CHARS_MAX = 262144;
/** How far back the errors-only read looks. */
export const LOG_ERRORS_SCAN = 2000;
/**
 * What a log read may hold in memory while compose answers: the errors-only scan's 2000 lines at
 * their 2000-character cut, about. The runner's 512m is shared with restores.
 */
export const LOG_CAPTURE_MAX_CHARS = 4_194_304;

/** One log read at a time (the ops agent's slice 4): a read meanwhile is refused, not queued. */
let logReadInFlight = false;

const COMPOSE_TIMEOUT_MS = 10_000;
const CUT_MARK = '…[cut]';

/** `?lines=1..500` (default 100) and `?errors=1|true`; anything else is the caller's 400. */
export function parseLogQuery(url) {
  const rawLines = url.searchParams.get('lines');
  const lines = rawLines === null ? LOG_LINES_DEFAULT : Number(rawLines);
  if (!/^\d+$/.test(rawLines ?? '1') || lines < 1 || lines > LOG_LINES_MAX) {
    throw refusal(400, `lines must be a whole number from 1 to ${LOG_LINES_MAX}.`);
  }
  const rawErrors = url.searchParams.get('errors');
  if (rawErrors !== null && !['1', 'true', '0', 'false'].includes(rawErrors)) {
    throw refusal(400, 'errors must be 1, true, 0 or false.');
  }
  return { lines, errorsOnly: rawErrors === '1' || rawErrors === 'true' };
}

/** A line over the cap, cut there, its last partial word dropped so no secret is half kept. */
function cutLine(line) {
  return `${line.slice(0, LOG_LINE_MAX_CHARS).replace(/[^\s"',]*$/u, '')}${CUT_MARK}`;
}

/**
 * The lines an answer may hold: the last `lines` (of the problem lines only, when `errorsOnly`),
 * each at most 2,000 characters, the whole at most 262,144 characters, oldest dropped first.
 */
export function boundLogLines(stdout, { lines, errorsOnly }, { capped = false } = {}) {
  let kept = String(stdout).split(/\r?\n/u);
  // A capped capture starts mid-line: that first line may hold half an address, so it goes.
  if (capped) kept = kept.slice(1);
  kept = kept.filter((line) => line.length > 0);
  if (errorsOnly) kept = kept.filter((line) => PROBLEM_LINE.test(line));
  kept = kept.slice(-lines);
  let truncated = capped;
  kept = kept.map((line) => {
    if (line.length <= LOG_LINE_MAX_CHARS) return line;
    truncated = true;
    return cutLine(line);
  });
  let total = kept.reduce((sum, line) => sum + line.length, 0);
  while (total > LOG_CHARS_MAX && kept.length > 0) {
    total -= kept.shift().length;
    truncated = true;
  }
  return { lines: kept, truncated };
}

/** `docker compose ps --all --format json` (one object per line), six fields copied by name. */
export function projectComposePs(stdout) {
  return String(stdout)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        throw new Error('docker compose ps answered a line that is not JSON.');
      }
      return {
        name: String(row.Name ?? ''),
        service: String(row.Service ?? ''),
        state: String(row.State ?? ''),
        health: row.Health ? String(row.Health) : null,
        status: String(row.Status ?? ''),
        exitCode: typeof row.ExitCode === 'number' ? row.ExitCode : null,
      };
    })
    .sort((a, b) => a.service.localeCompare(b.service) || a.name.localeCompare(b.name));
}

/** Runs compose; a timeout or a failure throws a fixed text (stderr can quote anything). */
async function compose(run, composeFlags, args, what, options) {
  const result = await run(
    'docker',
    ['compose', ...composeFlags, ...args],
    COMPOSE_TIMEOUT_MS,
    options,
  );
  if (result.timedOut) throw new Error(`docker compose ${what} timed out.`);
  if (result.code !== 0) throw new Error(`docker compose ${what} failed.`);
  return result;
}

/** The state of every container of the stack, stopped ones included. */
export async function readContainers(run, composeFlags) {
  const { stdout } = await compose(run, composeFlags, ['ps', '--all', '--format', 'json'], 'ps');
  return { generatedAt: new Date().toISOString(), containers: projectComposePs(stdout) };
}

/**
 * The last lines of one listed container's log; a service off the list is refused (403), a read
 * while another one runs too (409 `log_read_busy`).
 */
export async function readContainerLog(run, composeFlags, service, url) {
  if (!LOG_SERVICES.has(service)) {
    throw refusal(403, 'This service log is not readable.', 'service_not_allowed');
  }
  const query = parseLogQuery(url);
  if (logReadInFlight) {
    throw refusal(409, 'Another log read is running. Try again when it ends.', 'log_read_busy');
  }
  logReadInFlight = true;
  try {
    const tail = String(query.errorsOnly ? LOG_ERRORS_SCAN : query.lines);
    const { stdout, capped } = await compose(
      run,
      composeFlags,
      ['logs', '--no-color', '--no-log-prefix', '--timestamps', '--tail', tail, service],
      'logs',
      { maxChars: LOG_CAPTURE_MAX_CHARS },
    );
    return {
      generatedAt: new Date().toISOString(),
      service,
      ...boundLogLines(stdout, query, { capped: Boolean(capped) }),
    };
  } finally {
    logReadInFlight = false;
  }
}
