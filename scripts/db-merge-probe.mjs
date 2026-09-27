/**
 * The fighter merge probe (operator rulings 133 and 162): runs `merge_fighters` and
 * `revert_fighter_merge` (migration 0212) on a freshly replayed database and fails on any rule
 * they break.
 *
 * Why it exists. The merge used to be about eight API writes, tested with doubles. Ruling 133 made
 * it ONE database function each way, all or nothing; the rules moved into SQL, where no API test
 * can see them. This runs them: as the service role the API calls with, over seeded profiles, in
 * one transaction that is always rolled back, each scenario in its own savepoint.
 *
 * Run it after `pnpm db:migrations:replay`, on the same disposable database:
 *   DATABASE_URL=postgres://… pnpm db:merge-probe
 *
 * What it checks (the seed and the calls: lib/merge-probe-fixture.mjs; what moves:
 * lib/merge-probe-scenarios.mjs; the refusals: here):
 *   - a merge moves the follows (a follower of both keeps the survivor follow; ruling 116), the
 *     event people, and the instructor lines (one on a Workshop the survivor already teaches stays;
 *     ruling 161); fills the survivor's blanks (NULL or ''); keeps the stricter privacy answer each
 *     way (157); moves the account link only to an unowned survivor (159); flags the merged
 *     profile; and writes the record, whose shape the merge history and the revert read;
 *   - 1,500 follows move in one call: no page, no row cap;
 *   - a revert moves exactly those back, only rows still on the survivor and never onto a follow
 *     or an instructor line the restored profile already has, the account link only if the
 *     survivor still holds it; the survivor keeps its stricter answers; a record from before
 *     ruling 116 moves no follow;
 *   - every refusal, in the words the API answers (P0001 = 400, P0002 = 404; 125);
 *   - a failure at the last step (the record) leaves nothing moved;
 *   - only the service role may call either function.
 * Each check counts itself; the probe fails when any fails, and when fewer ran than it declares.
 */
import postgres from 'postgres';

import {
  I,
  P,
  PERSON,
  ROLLBACK,
  U,
  check,
  followedBy,
  id,
  lastMerge,
  merge,
  onProfile,
  probeResult,
  profile,
  refusal,
  revert,
  rolledBack,
  scenario,
  seed,
  snapshot,
  words,
} from './lib/merge-probe-fixture.mjs';
import {
  manyFollowsMoveInOneCall,
  mergeAndRevert,
  ownedSurvivorKeepsItsLink,
  recordBeforeFollowsMoved,
  revertMovesBackOnlyWhatIsStillThere,
  strictSurvivorStaysStrict,
} from './lib/merge-probe-scenarios.mjs';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  console.error(
    'DATABASE_URL is required and must point at a disposable, freshly replayed database (pnpm db:migrations:replay).',
  );
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
const EXPECTED_CHECKS = 69;

// ── Refusals (ruling 125) ───────────────────────────────────────────────────
async function refusalsBeforeAnyMerge(q) {
  const same = await refusal(q, (sp) => merge(sp, P.source, P.source));
  check('same profile', same, words('P0001', 'Source and target fighters must be different'));
  const noSource = await refusal(q, (sp) => merge(sp, id(99), P.target));
  check('unknown source', noSource, words('P0002', `source fighter ${id(99)} not found`));
  const noTarget = await refusal(q, (sp) => merge(sp, P.source, id(99)));
  check('unknown target', noTarget, words('P0002', `target fighter ${id(99)} not found`));
  const wrongSnapshot = await refusal(
    q,
    (sp) =>
      sp`SELECT public.merge_fighters(${P.source}, ${P.target}, ${U.actor}, NULL,
          ${JSON.stringify(snapshot(P.third))}::text::jsonb, ${JSON.stringify(snapshot(P.target))}::text::jsonb)`,
  );
  check('a snapshot of another profile', wrongSnapshot?.code, 'P0004');
  const noRecord = await refusal(q, (sp) => revert(sp, id(98)));
  check('unknown record', noRecord, words('P0002', `Merge audit log ${id(98)} not found`));
  const [other] =
    await q`INSERT INTO audit_log (action, entity_type, entity_id) VALUES ('fighter.update', 'fighter', ${P.source}) RETURNING id`;
  const notMerge = await refusal(q, (sp) => revert(sp, other.id));
  check('not a merge record', notMerge, words('P0001', 'Audit log entry is not a fighter merge'));
  const [bare] =
    await q`INSERT INTO audit_log (action, entity_type, entity_id, payload_json) VALUES ('fighter.merge', 'fighter', ${P.third}, '{}') RETURNING id`;
  check(
    'a record naming no profile',
    (await refusal(q, (sp) => revert(sp, bare.id)))?.code,
    'P0004',
  );
}

async function mergeRefusals(q) {
  await merge(q, P.source, P.target);
  const merged = await refusal(q, (sp) => merge(sp, P.source, P.third));
  check(
    'source already merged',
    merged,
    words('P0001', 'Source fighter is already merged into another profile'),
  );
  const intoMerged = await refusal(q, (sp) => merge(sp, P.third, P.source));
  check(
    'target merged away',
    intoMerged,
    words('P0001', 'Target fighter cannot be a merged/deleted profile'),
  );
  return lastMerge(q, P.source);
}

async function revertHistoryRefusals(q, first) {
  await merge(q, P.target, P.third);
  check(
    'survivor merged since',
    await refusal(q, (sp) => revert(sp, first.id)),
    words(
      'P0001',
      'The surviving fighter was merged into another profile since: revert that merge first',
    ),
  );
  await revert(q, (await lastMerge(q, P.target)).id);

  await revert(q, first.id);
  await q`UPDATE audit_log SET created_at = created_at - interval '1 second' WHERE id = ${first.id}`;
  await merge(q, P.source, P.target);
  check(
    'a later merge replaced it',
    await refusal(q, (sp) => revert(sp, first.id)),
    words('P0001', 'A later merge of this fighter replaced this one: revert the later merge first'),
  );
}

async function revertWindowRefusals(q, first) {
  const latest = await lastMerge(q, P.source);
  // The first record goes further back, so it stays the EARLIER merge while the latest moves.
  await q`UPDATE audit_log SET created_at = now() - interval '800 hours' WHERE id = ${first.id}`;
  await q`UPDATE audit_log SET created_at = now() - interval '720 hours 1 second' WHERE id = ${latest.id}`;
  check(
    'older than 30 days',
    await refusal(q, (sp) => revert(sp, latest.id)),
    words('P0001', 'Fighter merge can only be reverted within 30 days'),
  );
  await q`UPDATE audit_log SET created_at = now() - interval '719 hours' WHERE id = ${latest.id}`;
  check('inside 30 days', await refusal(q, (sp) => revert(sp, latest.id)), null);
}

async function refusals(tx) {
  await scenario(tx, async (q) => {
    await refusalsBeforeAnyMerge(q);
    const first = await mergeRefusals(q);
    await revertHistoryRefusals(q, first);
    await revertWindowRefusals(q, first);
  });
  await scenario(tx, async (q) => {
    await q`UPDATE global_persons SET deleted_at = now() WHERE id = ${P.third}`;
    check(
      'target deleted',
      await refusal(q, (sp) => merge(sp, P.source, P.third)),
      words('P0001', 'Target fighter cannot be a merged/deleted profile'),
    );
  });
}

// ── All or nothing, and who may call ────────────────────────────────────────
async function allOrNothing(tx) {
  await scenario(tx, async (q) => {
    // The record is the LAST write: make it fail, and every earlier write must be undone.
    await q`RESET ROLE`;
    await q`CREATE FUNCTION pg_temp.refuse_record() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'record refused'; END $$`;
    await q`CREATE TRIGGER merge_probe_refuse BEFORE INSERT ON audit_log
      FOR EACH ROW EXECUTE FUNCTION pg_temp.refuse_record()`;
    await q`SET LOCAL ROLE service_role`;
    const failed = await refusal(q, (sp) => merge(sp, P.source, P.target));
    check('the failing record fails the merge', failed?.message, 'record refused');
    check('no follow moved', await followedBy(q, U.alice), [P.source]);
    check('no person moved', await onProfile(q, 'persons', PERSON.s1), P.source);
    check('no instructor moved', await onProfile(q, 'workshop_instructors', I.sourceOwn), P.source);
    const untouched = await profile(q, P.target);
    const fields = [untouched.photo_url, untouched.hide, untouched.claim];
    check('survivor untouched', fields, [null, false, null]);
    const source = await profile(q, P.source);
    check('source untouched', [source.merged_into, source.claim], [null, U.lea]);
  });
}

async function onlyTheServiceRole(tx) {
  const signatures = [
    'public.merge_fighters(uuid, uuid, uuid, text, jsonb, jsonb)',
    'public.revert_fighter_merge(uuid, uuid)',
  ];
  const roles = [
    ['anon', false],
    ['authenticated', false],
    ['service_role', true],
  ];
  for (const signature of signatures) {
    for (const [role, allowed] of roles) {
      const [{ may }] =
        await tx`SELECT has_function_privilege(${role}, ${signature}, 'EXECUTE') AS may`;
      check(`${role} EXECUTE ${signature}`, may, allowed);
    }
  }
}

try {
  await rolledBack(() =>
    sql.begin(async (tx) => {
      await tx`SET LOCAL statement_timeout = '30s'`;
      await seed(tx);
      await mergeAndRevert(tx);
      await strictSurvivorStaysStrict(tx);
      await ownedSurvivorKeepsItsLink(tx);
      await revertMovesBackOnlyWhatIsStillThere(tx);
      await recordBeforeFollowsMoved(tx);
      await manyFollowsMoveInOneCall(tx);
      await refusals(tx);
      await allOrNothing(tx);
      await onlyTheServiceRole(tx);
      throw ROLLBACK;
    }),
  );
  const { checks, failures } = probeResult();
  if (checks !== EXPECTED_CHECKS)
    failures.push(
      `ran ${checks} checks, declares ${EXPECTED_CHECKS}: a scenario stopped early or grew`,
    );
  if (failures.length > 0) {
    console.error(`Merge probe FAILED (${failures.length}):\n  - ${failures.join('\n  - ')}`);
    process.exitCode = 1;
  } else {
    console.log(`Merge probe passed: ${checks} checks of merge_fighters and revert_fighter_merge.`);
  }
} catch (error) {
  console.error(`Merge probe could not run: ${error.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
