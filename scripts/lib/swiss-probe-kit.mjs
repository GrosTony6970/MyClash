/**
 * The rows and the calls check 17 of the RLS probe writes and reads (`swiss-probe.mjs`,
 * `swiss-status-probe.mjs`): a Swiss phase of the published Tournament seeded in each case's
 * savepoint (the RLS seed holds no Swiss row), its four entrants, and the Swiss functions of
 * migrations 0243 and 0244, called AS THE OWNER.
 */

import { errorOf, isolated, OPEN, SEED_COPY, TOURNAMENT } from './match-rules-probe-kit.mjs';
import { FIGHTER } from './fighter-status-probe-kit.mjs';

export { FIGHTER };
export const OPPONENT = 'c0f00000-0000-4000-8000-00000000000a';
export const THIRD = 'c0f00000-0000-4000-8000-0000000017a3';
export const FOURTH = 'c0f00000-0000-4000-8000-0000000017a4';
export const SWISS = '99999999-0000-4000-8000-0000000017a1';
export const FIELD = [FIGHTER, OPPONENT, THIRD, FOURTH];
export const LOCK_FIRST = String.raw`^\s*select\y[^;]*\yfrom\s+public\.phases\y[^;]*\yfor\s+no\s+key\s+update\s*;`;

/** The Swiss phase (3 rounds unless `roundCount`) and its four entrants. */
export async function seedSwiss(sp, roundCount = 3) {
  await sp`INSERT INTO phases (id, tournament_id, type, sort_order, config_json)
           VALUES (${SWISS}, ${TOURNAMENT}, 'swiss', 2, ${sp.json({ roundCount, finalized: null })})`;
  for (const [n, id] of [
    [3, THIRD],
    [4, FOURTH],
  ]) {
    const person = `b0f00000-0000-4000-8000-0000000017b${n}`;
    await sp`INSERT INTO persons (id, event_id, given_name, family_name)
             VALUES (${person}, ${OPEN}, 'Probe', ${`Swiss ${n}`})`;
    await sp`INSERT INTO registrations (id, tournament_id, person_id)
             VALUES (${id}, ${TOURNAMENT}, ${person})`;
  }
  for (const id of FIELD) {
    await sp`INSERT INTO swiss_entrants (phase_id, registration_id) VALUES (${SWISS}, ${id})`;
  }
}

/** A bout as `swissMatchRows` builds it, without its phase and round. */
export const bout = (red, blue, board, status = 'scheduled', round = 1) => ({
  red_registration_id: red,
  blue_registration_id: blue,
  status,
  match_number_label: `SW-R${round}-M${board}`,
  match_rules_id: SEED_COPY,
});

export const commit = async (sp, round, field, bouts, bye = null, meta = { warnings: [] }) =>
  (
    await sp`SELECT public.swiss_commit_round(${SWISS}, ${round}, ${field}::uuid[], ${bye},
                                              ${sp.json(meta)}, ${sp.json(bouts)}) AS r`
  )[0].r;

export const withdraw = async (sp, registration, by) =>
  (await sp`SELECT public.swiss_withdraw(${SWISS}, ${registration}, ${by}) AS r`)[0].r;

export const putBack = async (sp, registration, by) =>
  (await sp`SELECT public.swiss_put_back(${SWISS}, ${registration}, ${by}) AS r`)[0].r;

export const over = async (sp) => (await sp`SELECT public.swiss_phase_over(${SWISS}) AS r`)[0].r;

export const deleteLast = async (sp, round, fought = ['running', 'paused', 'completed']) =>
  (await sp`SELECT public.swiss_delete_last_round(${SWISS}, ${round}, ${fought}::text[]) AS r`)[0]
    .r;

export const roundCount = async (sp) =>
  (await sp`SELECT count(*)::int AS n FROM swiss_rounds WHERE phase_id = ${SWISS}`)[0].n;

export const entrantOf = async (sp, registration) =>
  (
    await sp`SELECT withdrawn_at_round, withdrawn_by, missed_rounds FROM swiss_entrants
             WHERE phase_id = ${SWISS} AND registration_id = ${registration}`
  )[0];

/** The phase finalised (`finalized` an object), or resumed (back to a JSON null). */
export const finalise = (sp, finalised = true) =>
  sp`UPDATE phases SET config_json = config_json || ${sp.json({
    finalized: finalised ? { atRound: 1 } : null,
  })} WHERE id = ${SWISS}`;

/** A savepoint RELEASED on success and rolled back only on its error; the error, or null. */
export async function released(sp, statement) {
  try {
    await sp.savepoint(statement);
    return null;
  } catch (error) {
    return error;
  }
}

/**
 * Each case on a fresh Swiss seed; each refusal refused by its SQLSTATE, its CHECK's name, or the
 * message prefix the API maps (`prefix`). What is wrong, as sentences.
 */
export async function caseFailures(tx, cases, refusals) {
  const failures = [];
  for (const { what, seed = seedSwiss, run } of cases) {
    const error = await errorOf(tx, async (sp) => {
      await seed(sp);
      await run(sp);
    });
    if (error) failures.push(`check 17: ${what}: ${error.message}`);
  }
  for (const { what, code, by, prefix, setup, run } of refusals) {
    let error = null;
    await isolated(tx, async (sp) => {
      await seedSwiss(sp);
      if (setup) await setup(sp);
      error = await errorOf(sp, run);
    });
    const refused = by
      ? error?.constraint_name === by || String(error?.message).includes(by)
      : error?.code === code && (!prefix || String(error?.message).startsWith(prefix));
    if (!refused) {
      failures.push(
        `check 17: ${what} is not refused by ${by ?? prefix ?? code} (${error ? error.message : 'taken'})`,
      );
    }
  }
  return failures;
}

/** Who may call each function, its volatility, and (`locked`) the phase lock first. */
export async function functionFailures(tx, fns, { locked }) {
  const failures = [];
  for (const fn of fns) {
    const [exists] = await tx`SELECT to_regprocedure(${fn}) IS NOT NULL AS ok`;
    if (!exists.ok) {
      failures.push(`check 17: ${fn} does not exist`);
      continue;
    }
    const [row] = await tx`
      SELECT has_function_privilege('anon', ${fn}::regprocedure, 'EXECUTE') AS anon,
             has_function_privilege('authenticated', ${fn}::regprocedure, 'EXECUTE') AS authed,
             has_function_privilege('service_role', ${fn}::regprocedure, 'EXECUTE') AS service,
             p.provolatile,
             substring(p.prosrc FROM '\\ybegin\\y(.*)$') ~* ${LOCK_FIRST} AS locks
      FROM pg_proc p WHERE p.oid = ${fn}::regprocedure`;
    if (row.anon || row.authed) failures.push(`check 17: a web role may execute ${fn}`);
    if (!row.service) failures.push(`check 17: the service role may not execute ${fn}`);
    if (row.provolatile !== 'v') failures.push(`check 17: ${fn} is not VOLATILE`);
    if (locked && !row.locks) failures.push(`check 17: ${fn} does not lock the phase first`);
  }
  return failures;
}
