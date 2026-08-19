/**
 * The gate contract: a check returns findings, this decides everything else.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Nineteen gates in scripts/check-*.mjs each do the same four jobs: discover
 * files, accumulate findings, report them, stop the build. scripts/lib already
 * owns discovery — the walk, the migration corpus, the pinned-file reader, the
 * SQL stripper. Nothing owned the other three, so all nineteen wrote their own:
 * six different accumulator names, four incompatible report formats, and two
 * ways of failing the build.
 *
 * The duplication was not the cost. The cost was that a gate doing its work at
 * module load cannot be IMPORTED without running the check and possibly killing
 * the importing process, so it cannot be tested. The correlation was exact when
 * this was written: 8 gates exported something, and those exact 8 were the 8
 * with tests; 11 exported nothing, and those exact 11 had no test. No
 * exceptions in either direction. Export and test arrived together every single
 * time, because export is the only thing standing between a gate and a test.
 *
 * ── The two ways a gate harness goes silently wrong ─────────────────────────
 * Both were measured before this file was written, not reasoned about, because
 * both fail in the direction that looks like success.
 *
 * 1. A gate that never reports must not pass. `process.exitCode = 1` alone does
 *    not give you that: a promise that never settles keeps nothing alive, so
 *    node drains the loop and exits 0. A hung gate would report a clean repo.
 *    Hence the fail-safe in `execute` — exit 1 is set BEFORE the run and cleared
 *    only by a report that got all the way through.
 *
 * 2. Importing a gate must have no effect. scripts/build-app-bundles.mjs
 *    imports `parseRequiredEnv` out of check-client-env-contract.mjs, on the
 *    production path, inside `pnpm perf:bundle:build`. If the fail-safe above
 *    were set at module scope, that import alone would fail the bundle build
 *    with no message, and `node --test` would exit 1 with every test passing.
 *    Hence: `defineGate` has no effect unless the module IS the entry point.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   export const gate = defineGate({
 *     name: 'Untracked debt markers',
 *     entry: import.meta.url,
 *     run: ({ argv }) => ({ findings, summary, scanned, remedy }),
 *   });
 *
 * `remedy` is optional and prints only when the gate failed; everything else is
 * required.
 *
 * The returned object lets a test call `gate.run({ argv: [] })` and assert on
 * findings with no process, no exit code and no console involved.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** A finding is `{ level, message }`. Anything that is not exactly 'warn' is an
 *  error — see `levelOf`. */
const WARN = 'warn';

/**
 * Whether this module is the program node was asked to run.
 *
 * ── Why real paths and not the URL ──────────────────────────────────────────
 * The fleet used to guard with `process.argv[1]?.endsWith('check-x.mjs')`, which
 * matches any file whose name happens to end the same way. Comparing
 * `pathToFileURL(process.argv[1]).href` to `import.meta.url` looks like the
 * sound fix and is not: on Windows the two disagree on drive-letter case
 * (`file:///f:/…` against `file:///F:/…`) and the gate silently never runs.
 * `realpathSync.native` normalises the case and resolves links, so both sides
 * are spelled the same way by the operating system.
 *
 * False, never throwing, when there is no entry point (`node -e` leaves argv[1]
 * undefined) or when a path does not resolve. A path that is not there is not
 * this module.
 */
function isInvokedDirectly(entry) {
  const invoked = process.argv[1];
  if (!invoked) return false;
  try {
    return realpathSync.native(invoked) === realpathSync.native(fileURLToPath(entry));
  } catch {
    return false;
  }
}

/**
 * Error unless the finding says 'warn' exactly.
 *
 * Six gates pushed bare strings into their accumulator before this module
 * existed, so a half-finished migration will hand us one. Treating an
 * unrecognised shape as a warning would turn a blocker into a line of noise
 * that still exits 0; treating it as an error is loud, and loud is recoverable.
 */
function levelOf(finding) {
  return finding?.level === WARN ? WARN : 'error';
}

function messageOf(finding) {
  if (typeof finding === 'string') return finding;
  return String(finding?.message ?? finding);
}

/**
 * The shape `run` promised to return.
 *
 * Every one of these throws rather than defaults, because each default would be
 * a gate that reports less than it looks like it does. `scanned` is the one that
 * matters most: it is the count the rule actually examined AFTER filtering, and
 * a zero means the discovery step broke, not that the repo is clean. Exactly one
 * gate in the fleet asserted this before the harness; the other eighteen would
 * have passed a scan over nothing.
 */
function validate(name, result) {
  if (!result || typeof result !== 'object') {
    throw new TypeError(`${name}: run() must return { findings, summary, scanned }`);
  }
  if (!Array.isArray(result.findings)) {
    throw new TypeError(`${name}: run() returned no findings array`);
  }
  if (typeof result.summary !== 'string' || !result.summary) {
    throw new TypeError(
      `${name}: run() returned no summary — a passing gate has to say what it saw`,
    );
  }
  if (typeof result.scanned !== 'number' || !Number.isFinite(result.scanned)) {
    throw new TypeError(`${name}: run() returned no scanned count`);
  }
  if (result.scanned === 0) {
    throw new Error(`${name}: scanned nothing — the discovery step is broken, not the repo clean`);
  }
  if (result.remedy !== undefined && (typeof result.remedy !== 'string' || !result.remedy)) {
    throw new TypeError(`${name}: remedy must be a non-empty string when given`);
  }
}

/**
 * Print the verdict. Returns whether the gate passed.
 *
 * Warnings first and unheaded, the way check-edge-tls.mjs already printed them:
 * they are context for the errors below, not a section of their own. Only
 * `finding.message`, `summary` and `remedy` reach the console — never the
 * returned object. check-edge-plugins findings can carry HTTP response detail
 * from a host reached with a bearer token, so the harness must not print more
 * than the gate meant to.
 *
 * ── Why `remedy` is part of the contract ────────────────────────────────────
 * Several gates close with a paragraph saying what to DO: check-openapi-drift
 * names the regenerate command, check-mermaid explains that a bad diagram
 * renders as grey text rather than failing, check-source-bytes spends four
 * lines on why a raw NUL is worth caring about. That text is the difference
 * between a list of paths and a fix, and it is only worth printing when the
 * gate failed — so the harness owns when, and the gate owns what.
 */
function report(name, { findings, summary, remedy }) {
  const warnings = findings.filter((finding) => levelOf(finding) === WARN);
  const errors = findings.filter((finding) => levelOf(finding) !== WARN);

  for (const warning of warnings) console.warn(`  ! ${messageOf(warning)}`);

  if (errors.length) {
    console.error(`${name} failed:`);
    for (const error of errors) console.error(`  - ${messageOf(error)}`);
    if (remedy) console.error(`\n${remedy}`);
    return false;
  }

  console.log(summary);
  return true;
}

/**
 * Run the gate and decide the exit code.
 *
 * `process.exitCode`, never `process.exit`: the latter terminates without
 * unwinding, so a gate's own cleanup silently never runs. That is not
 * hypothetical here — check-openapi-drift.mjs leaked a temp directory on every
 * run for exactly that reason, 344 of them on one machine.
 *
 * The fail-safe is the first line for the reason in the file header: anything
 * that stops this function short of a completed report — a hang, a throw, a
 * promise that never settles — has to leave the build red.
 */
async function execute(gate) {
  process.exitCode = 1;
  try {
    const result = await gate.run({ argv: process.argv.slice(2) });
    validate(gate.name, result);
    if (report(gate.name, result)) process.exitCode = 0;
  } catch (error) {
    // A broken gate and a dirty repo are different answers. The fleet could not
    // tell them apart; a stack under its own header says which one this is.
    console.error(`${gate.name} could not run — the gate is broken, not the repo:`);
    console.error(error?.stack ?? String(error));
  }
}

/**
 * Declare a gate. Returns it, and runs it only when this module is the entry
 * point.
 *
 * `entry` is the caller's `import.meta.url`. It is required rather than derived
 * because a module cannot see its own URL from in here.
 */
export function defineGate({ name, entry, run }) {
  if (typeof name !== 'string' || !name) {
    throw new TypeError('defineGate: name is required');
  }
  if (typeof entry !== 'string' || !entry.startsWith('file:')) {
    throw new TypeError('defineGate: entry must be import.meta.url');
  }
  if (typeof run !== 'function') {
    throw new TypeError('defineGate: run must be a function');
  }

  const gate = { name, run };

  if (isInvokedDirectly(entry)) {
    void execute(gate).catch((error) => {
      // Only reachable if the console itself failed. Still not silent.
      process.exitCode = 1;
      console.error(`${name} crashed while reporting: ${error?.stack ?? String(error)}`);
    });
  }

  return gate;
}
