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
 * comment; a block ending the blocked fighter's waiting request as a no and the blocker's own as
 * withdrawn, leaving an agreed spar alone; the table's CHECKs; an Event delete keeping the
 * request; only the service role may call the three functions.
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
  noAskingTwice,
  seed,
  tableShape,
} from './lib/fightbook-probe-scenarios.mjs';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  console.error(
    'DATABASE_URL is required and must point at a disposable, freshly replayed database (pnpm db:migrations:replay).',
  );
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
const EXPECTED_CHECKS = 44;

async function onlyTheServiceRole(tx) {
  const roles = [
    ['anon', false],
    ['authenticated', false],
    ['service_role', true],
  ];
  for (const signature of FUNCTIONS) {
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
      await blocking(tx);
      await tableShape(tx);
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
    console.log(`FightBook probe passed: ${checks} checks of fightbook_ask, _answer and _block.`);
  }
} catch (error) {
  console.error(`FightBook probe could not run: ${error.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
