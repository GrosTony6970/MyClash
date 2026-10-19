/**
 * Check 13 of the RLS probe (`scripts/db-rls-probe.mjs`): an audited change of a Tournament's rules
 * writes only over what it read (migration 0234).
 *
 * On the running database: `repin_tournament_rules` with the row as read writes the Tournament's
 * rules (a JSON null setting stored as SQL NULL), the record under the locked row's Event (never
 * one the caller names) with `placings_after` unfilled, stamps the bout not started onto a new
 * copy, and answers the record's id; with a stale read it refuses `rules_changed_since_read` and
 * writes nothing; neither public role may call it, the service role may. Every case runs in a
 * savepoint always rolled back. The two-session lock is the slice's live script, not this check.
 */

import {
  BOUT,
  OPEN,
  SEED_COPY,
  TOURNAMENT,
  boutOf,
  errorOf,
  isolated,
} from './match-rules-probe-kit.mjs';
import { attempt } from './ruleset-pair-probe.mjs';

// An Event that does not exist: a record filed under it would fail the foreign key.
const NO_EVENT = 'eeeeeeee-0000-4000-8000-0000000000ff';

const COLUMNS = `ruleset_code, ruleset_version, ruleset_config, scoring_config_json,
  penalty_ruleset_id, penalty_ruleset_version`;
const readRow = async (sp) =>
  (await sp.unsafe(`SELECT ${COLUMNS} FROM tournaments WHERE id = $1`, [TOURNAMENT]))[0];

const NEXT = {
  ruleset_code: 'TF_v1',
  ruleset_version: '1.1.0',
  ruleset_config: { matchFormat: { pointCap: 7 } },
  scoring_config_json: null,
  ruleset_content_hash: 'rls-probe-audited',
};
const AUDIT = {
  event_id: NO_EVENT,
  actor_user_id: null,
  kind: 'settings',
  from_code: 'TF_v1',
  from_version: '1.1.0',
  to_code: 'TF_v1',
  to_version: '1.1.0',
  justification: 'The probe checks an audited write.',
  bucket_diff: {},
  ranking_compatible: true,
  placings_before: [],
  config_before: null,
  config_after: null,
  changes: [],
};

const repin = (sp, expected) =>
  sp`SELECT public.repin_tournament_rules(${TOURNAMENT}, ${sp.json(expected)}, ${sp.json(NEXT)},
       ${sp.json(AUDIT)}) AS id`;

const recordCount = async (sp) =>
  Number(
    (
      await sp`SELECT count(*) AS n FROM tournament_ruleset_repins
              WHERE tournament_id = ${TOURNAMENT}`
    )[0].n,
  );

async function writeFailures(tx, failures) {
  await isolated(tx, async (sp) => {
    let id;
    try {
      [{ id }] = await repin(sp, await readRow(sp));
    } catch (error) {
      failures.push(`an audited write with the row as read was refused (${error.message})`);
      return;
    }
    const [t] = await sp`SELECT ruleset_config, scoring_config_json IS NULL AS sql_null,
                                ruleset_content_hash FROM tournaments WHERE id = ${TOURNAMENT}`;
    if (
      t.ruleset_config?.matchFormat?.pointCap !== 7 ||
      t.ruleset_content_hash !== NEXT.ruleset_content_hash
    )
      failures.push(`an audited write left the Tournament on ${JSON.stringify(t)}`);
    if (!t.sql_null) failures.push('an audited write stored a JSON null setting, not SQL NULL');
    const [record] = await sp`SELECT event_id, kind, placings_after FROM tournament_ruleset_repins
                              WHERE id = ${id}`;
    if (record?.event_id !== OPEN)
      failures.push(
        `an audited write filed its record under ${record?.event_id}, not the Tournament's Event`,
      );
    if (record?.kind !== 'settings' || record.placings_after !== null)
      failures.push(`an audited write recorded ${JSON.stringify(record)}`);
    if ((await boutOf(sp, BOUT)).match_rules_id === SEED_COPY)
      failures.push('an audited write did not stamp the bout not started');
  });
}

async function staleFailures(tx, failures) {
  await isolated(tx, async (sp) => {
    const before = { row: await readRow(sp), records: await recordCount(sp) };
    const stale = { ...before.row, ruleset_version: '0.9.0' };
    const error = await errorOf(sp, (inner) => repin(inner, stale));
    if (error?.code !== 'P0001' || error.message !== 'rules_changed_since_read')
      failures.push(`a stale audited write was not refused (${error?.message ?? 'no error'})`);
    const after = { row: await readRow(sp), records: await recordCount(sp) };
    if (JSON.stringify(after) !== JSON.stringify(before))
      failures.push('a refused audited write changed the Tournament or its records');
  });
}

// A signed-in call is refused by the Tournament's own write revoke (0233) even when the function is
// granted, so the refusal must name the function, and its privilege is read as well.
async function grantFailures(tx, failures) {
  const signature = 'public.repin_tournament_rules(uuid, jsonb, jsonb, jsonb)';
  const expected = await readRow(tx);
  for (const role of ['anon', 'authenticated']) {
    const [{ granted }] =
      await tx`SELECT has_function_privilege(${role}, ${signature}, 'execute') AS granted`;
    if (granted) failures.push(`${role} holds EXECUTE on repin_tournament_rules`);
    const error = await attempt(tx, role, (sp) => repin(sp, expected));
    if (error?.code !== '42501' || !error.message.includes('function repin_tournament_rules'))
      failures.push(`${role} called repin_tournament_rules (${error?.message ?? 'no error'})`);
  }
  const served = await attempt(tx, 'service_role', (sp) => repin(sp, expected));
  if (served)
    failures.push(`the service role could not call repin_tournament_rules (${served.message})`);
}

/** What is wrong, as sentences; none when all is right. */
export async function rulesWriteFailures(tx) {
  const failures = [];
  await writeFailures(tx, failures);
  await staleFailures(tx, failures);
  await grantFailures(tx, failures);
  return failures;
}
