/**
 * Check 8 of the RLS probe (`scripts/db-rls-probe.mjs`): one push address, one account (migration
 * 0219, operator ruling 238).
 *
 * A browser holds one push address whoever is signed in. Saved under two accounts, it shows the
 * first account's alerts to the second. The unique index refuses the second row; the API's save
 * moves the address to its caller in one statement; a signed-in caller cannot do that move
 * through PostgREST, because the row is not theirs to update.
 */

const ANNA = '11111111-1111-4111-8111-111111111111';
const BEN = '22222222-2222-4222-8222-222222222222';
const LAPTOP = 'https://push.example.test/laptop';

// Thrown to end a savepoint on purpose: the rows and the role set inside it end with it.
const ROLLBACK = new Error('rollback');

/** One statement as one role, in a savepoint of its own: the error it raised, or null. */
async function attempt(tx, statement) {
  try {
    await tx.savepoint(statement);
    return null;
  } catch (error) {
    return error;
  }
}

const save = (sp, userId) => sp`
  INSERT INTO push_subscriptions (user_id, endpoint, p256dh_key, auth_key)
  VALUES (${userId}, ${LAPTOP}, 'key', 'auth')
  ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id`;

async function failuresInside(sp) {
  const failures = [];
  await sp`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh_key, auth_key)
    VALUES (${ANNA}, ${LAPTOP}, 'key', 'auth')`;

  const second = await attempt(
    sp,
    (inner) => inner`
      INSERT INTO push_subscriptions (user_id, endpoint, p256dh_key, auth_key)
      VALUES (${BEN}, ${LAPTOP}, 'key', 'auth')`,
  );
  if (second?.code !== '23505')
    failures.push(
      `a push address was saved under a second account (${second?.message ?? 'no error'}): its alerts ring for both`,
    );

  const signedIn = JSON.stringify({ role: 'authenticated', sub: BEN });
  const direct = await attempt(sp, async (inner) => {
    await inner`SET LOCAL ROLE authenticated`;
    await inner`SELECT set_config('request.jwt.claims', ${signedIn}, true)`;
    await save(inner, BEN);
  });
  // Refused by the policy (42501) on a database with no account rows, and by the
  // policies' own helper loop (54001, ruling 111a) on the seeded one.
  if (direct?.code !== '42501' && direct?.code !== '54001')
    failures.push(
      `a signed-in caller was not refused another account's push address (${direct?.message ?? 'no error'})`,
    );

  const api = await attempt(sp, async (inner) => {
    await inner`SET LOCAL ROLE service_role`;
    await save(inner, BEN);
  });
  const holders = await sp`
    SELECT user_id::text AS id FROM push_subscriptions WHERE endpoint = ${LAPTOP}`;
  if (api || JSON.stringify(holders.map((row) => row.id)) !== JSON.stringify([BEN]))
    failures.push(
      `the API's save did not move the push address to its caller (${api?.message ?? `held by ${holders.map((row) => row.id)}`})`,
    );
  return failures;
}

/** What is wrong, as sentences; none when all is right. Leaves no row behind. */
export async function pushAddressFailures(tx) {
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
