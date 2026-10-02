/**
 * Check 7 of the RLS probe (`scripts/db-rls-probe.mjs`): who may call `account_emails`, and what it
 * answers (migration 0217, operator ruling 215).
 *
 * The function reads `auth.users` with its owner's rights. Open to a public role, it would hand any
 * visitor the address behind any account id: the image grants EXECUTE on a new function to anon and
 * authenticated by default, and a REVOKE from PUBLIC alone leaves those grants in place.
 */

/**
 * The accounts of `rls-probe-seed.sql`: one with an address, one without, one with an empty one;
 * and an id none has. The seed holds one more account with an address, which is NOT asked for
 * here: it must have no row.
 */
const ACCOUNTS = {
  withAddress: '11111111-1111-4111-8111-111111111111',
  address: 'rls-probe-admin@example.test',
  noAddress: '22222222-2222-4222-8222-222222222222',
  emptyAddress: '55555555-5555-4555-8555-555555555555',
  none: '33333333-3333-4333-8333-333333333333',
};
const IDS = [ACCOUNTS.withAddress, ACCOUNTS.noAddress, ACCOUNTS.emptyAddress, ACCOUNTS.none];

// Thrown to end a savepoint on purpose: the role set inside it ends with it.
const ROLLBACK = new Error('rollback');

/** `account_emails` as one role, in a savepoint that is always rolled back: its rows, or its error. */
async function callAs(tx, become) {
  const answer = { rows: null, failure: null };
  try {
    await tx.savepoint(async (sp) => {
      await become(sp);
      try {
        answer.rows = await sp`
          SELECT user_id::text AS id, email FROM account_emails(${IDS}::uuid[])`;
      } catch (error) {
        answer.failure = error;
      }
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
  return answer;
}

/** What is wrong, as sentences; none when all is right. Run it after the seed, in its transaction. */
export async function accountEmailsFailures(tx) {
  const failures = [];
  const signedIn = JSON.stringify({ role: 'authenticated', sub: ACCOUNTS.withAddress });
  const publicRoles = {
    anon: (sp) => sp`SET LOCAL ROLE anon`,
    authenticated: async (sp) => {
      await sp`SET LOCAL ROLE authenticated`;
      await sp`SELECT set_config('request.jwt.claims', ${signedIn}, true)`;
    },
  };
  for (const [role, become] of Object.entries(publicRoles)) {
    const { failure } = await callAs(tx, become);
    if (!failure) failures.push(`${role} may call account_emails: it hands out account addresses`);
    else if (
      failure.code !== '42501' ||
      !failure.message.startsWith('permission denied for function')
    )
      failures.push(`account_emails did not refuse ${role} on privilege: ${failure.message}`);
  }

  const api = await callAs(tx, (sp) => sp`SET LOCAL ROLE service_role`);
  const got = JSON.stringify(api.rows?.map((row) => [row.id, row.email]));
  if (api.failure)
    failures.push(`the service role cannot call account_emails: ${api.failure.message}`);
  else if (got !== JSON.stringify([[ACCOUNTS.withAddress, ACCOUNTS.address]]))
    failures.push(
      `account_emails answered ${got}: only an account that was asked for and has an address has a row`,
    );
  return failures;
}
