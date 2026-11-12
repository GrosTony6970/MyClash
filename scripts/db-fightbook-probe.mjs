/**
 * The FightBook probe (slice 1): runs `fightbook_ask`, `fightbook_answer` and `fightbook_block`
 * (migration 0264) on a freshly replayed database and fails on any rule they break.
 *
 * Why it exists. The rules that must win a race — one waiting request per pair, no asking twice,
 * a block that ends what waits between two fighters, an answer that lands only on a request still
 * open — live in SQL, where no API test can see them. This runs them as the service role the API
 * calls with, over seeded profiles, in one transaction that is always rolled back, each scenario
 * in its own savepoint (the merge probe's fixture).
 *
 * Run it after `pnpm db:migrations:replay`, on the same disposable database:
 *   DATABASE_URL=postgres://… pnpm db:fightbook-probe
 *
 * What it checks (lib/fightbook-probe-scenarios.mjs): asking, and each refusal; no asking twice
 * for the same Event, nor for a free date until 7 days after the refused ask; a request past its
 * end cannot be answered and does not hold up a new ask; a yes, a no with a private or a shown
 * comment; a declined request and one a block stored ended being the same row; a block ending the
 * blocked fighter's waiting request as a no and the blocker's own as withdrawn, leaving an agreed
 * spar alone, and naming a live profile only; the table's CHECKs; an Event delete keeping the
 * request; only the service role may call the three functions.
 * Slice 3 (lib/fightbook-probe-reviews.mjs, migration 0267): a review only on a `done` spar, by
 * one of its two fighters, once, after the API's clock passes 48 h after the end; an anonymous
 * review in its own table and a signed one with a blank text keeping none, a text kept trimmed; a
 * merged, deleted or erased author writing nothing; the window exact to the millisecond on the
 * API's clock; the star line over both tables, per subject, moving at once; the new CHECKs, named;
 * only the service role may call the two functions.
 * Slice 4 (lib/fightbook-probe-flags.mjs and lib/fightbook-probe-flag-readers.mjs, migration 0269):
 * a safety flag only on an agreed, done or cancelled spar, by one of its fighters, once, the snapshot
 * of the spar and of the flagged account; the merge family; who must never read a flag (the flagged
 * account, before or after an unlink, across a merge and its revert, and the club while no account
 * holds the fighter); the exact page; the handled mark; the alert's recipients; erasure reaching no
 * further than the erased account; the foreign-key actions; only the service role may call the
 * seven functions.
 * Each check counts itself; the probe fails when any fails, and when fewer ran than it declares.
 */
import postgres from 'postgres';

import { ROLLBACK, check, probeResult, rolledBack } from './lib/merge-probe-fixture.mjs';
import {
  FUNCTIONS,
  answering,
  answeringWithComments,
  asking,
  blocking,
  everyNoIsOneRow,
  noAskingTwice,
  seed,
  tableShape,
} from './lib/fightbook-probe-scenarios.mjs';
import {
  REVIEW_FUNCTIONS,
  reviewTableShape,
  reviewing,
  starLineMoves,
} from './lib/fightbook-probe-reviews.mjs';
import { flagShown, flagWrites, profileFamily, seedFlags } from './lib/fightbook-probe-flags.mjs';
import {
  FLAG_FUNCTIONS,
  flagForeignKeys,
  flagMark,
  flagRecipients,
  flagsErase,
  flagsPage,
} from './lib/fightbook-probe-flag-readers.mjs';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  console.error(
    'DATABASE_URL is required and must point at a disposable, freshly replayed database (pnpm db:migrations:replay).',
  );
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
const EXPECTED_CHECKS = 154;

async function onlyTheServiceRole(tx) {
  const roles = [
    ['anon', false],
    ['authenticated', false],
    ['service_role', true],
  ];
  for (const signature of [...FUNCTIONS, ...REVIEW_FUNCTIONS, ...FLAG_FUNCTIONS]) {
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
      await asking(tx);
      await noAskingTwice(tx);
      await answering(tx);
      await answeringWithComments(tx);
      await everyNoIsOneRow(tx);
      await blocking(tx);
      await tableShape(tx);
      await reviewing(tx);
      await starLineMoves(tx);
      await reviewTableShape(tx);
      await seedFlags(tx);
      await flagWrites(tx);
      await profileFamily(tx);
      await flagShown(tx);
      await flagsPage(tx);
      await flagMark(tx);
      await flagRecipients(tx);
      await flagsErase(tx);
      await flagForeignKeys(tx);
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
    console.error(`FightBook probe FAILED (${failures.length}):\n  - ${failures.join('\n  - ')}`);
    process.exitCode = 1;
  } else {
    console.log(
      `FightBook probe passed: ${checks} checks of fightbook_ask, _answer, _block, _review, _star_line and the seven safety flag functions.`,
    );
  }
} catch (error) {
  console.error(`FightBook probe could not run: ${error.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
