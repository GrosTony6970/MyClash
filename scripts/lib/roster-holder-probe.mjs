/**
 * Check 9 of the RLS probe (`scripts/db-rls-probe.mjs`): an account holds one roster row at an
 * Event (migration 0220, operator ruling 296).
 *
 * The booking door, my-schedule and the pass each read ONE roster row for an account at an
 * Event. A second row makes that read fail, and the account is blocked at that Event. The
 * unique index refuses the second row at its own write, by an insert or by a claim; it leaves
 * alone the rows no account holds, another account's row, and the same account's row at
 * another Event.
 */

const PAUL = '66666666-6666-4666-8666-666666666666';
const LEA = '77777777-7777-4777-8777-777777777777';
// The two Events of `rls-probe-seed.sql`.
const OPEN = 'eeeeeeee-0000-4000-8000-00000000000a';
const DRAFT = 'eeeeeeee-0000-4000-8000-00000000000b';
const UNHELD = 'bbbbbbbb-0000-4000-8000-0000000000f1';

// Thrown to end a savepoint on purpose: the rows inside it end with it.
const ROLLBACK = new Error('rollback');

/** One statement in a savepoint of its own: the error it raised, or null. */
async function attempt(tx, statement) {
  try {
    await tx.savepoint(statement);
    return null;
  } catch (error) {
    return error;
  }
}

const rosterRow = (sp, eventId, holder, name) => sp`
  INSERT INTO persons (event_id, given_name, family_name, claim_status, claimed_by_user_id)
  VALUES (${eventId}, ${name}, 'Probe', ${holder ? 'claimed' : 'unclaimed'}, ${holder})`;

async function failuresInside(sp) {
  const failures = [];
  await rosterRow(sp, OPEN, PAUL, 'Paul');

  // What must still be written: the index counts a holder at an Event, nothing else.
  const allowed = [
    ['a second row no account holds', (inner) => rosterRow(inner, OPEN, null, 'Nobody')],
    ['a row of another account at the same Event', (inner) => rosterRow(inner, OPEN, LEA, 'Lea')],
    [
      'a row of the same account at another Event',
      (inner) => rosterRow(inner, DRAFT, PAUL, 'Paul'),
    ],
  ];
  for (const [what, write] of allowed) {
    const refused = await attempt(sp, write);
    if (refused) failures.push(`${what} was refused (${refused.message}): the index is too wide`);
  }

  const second = await attempt(sp, (inner) => rosterRow(inner, OPEN, PAUL, 'Paul again'));
  if (second?.code !== '23505')
    failures.push(
      `an account was given a second roster row at one Event by an insert (${second?.message ?? 'no error'}): its booking, schedule and pass there fail`,
    );

  await sp`
    INSERT INTO persons (id, event_id, given_name, family_name)
    VALUES (${UNHELD}, ${OPEN}, 'Unheld', 'Probe')`;
  const claim = await attempt(
    sp,
    (inner) => inner`
      UPDATE persons SET claim_status = 'claimed', claimed_by_user_id = ${PAUL}
      WHERE id = ${UNHELD}`,
  );
  if (claim?.code !== '23505')
    failures.push(
      `an account was given a second roster row at one Event by a claim (${claim?.message ?? 'no error'})`,
    );
  return failures;
}

/** What is wrong, as sentences; none when all is right. Leaves no row behind. */
export async function rosterHolderFailures(tx) {
  let failures = [];
  try {
    await tx.savepoint(async (sp) => {
      failures = await failuresInside(sp);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
  return failures;
}
