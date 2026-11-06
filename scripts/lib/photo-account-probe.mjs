/**
 * The photo-account cases of the cascade probe (migration 0254, slice 6a): a photo sent from a
 * personal space names its account, and that link refuses the account's delete. Each case runs in
 * a transaction the probe rolls back, on the seed's committed Event.
 *
 * Why the refusal is proved as a stranger role: in production the auth server deletes an account
 * as its own role (`supabase_auth_admin`), which owns nothing in `public` and may not write the
 * deny-all tombstones. A cascade there would fire the photo's row trigger as that role. The probe
 * deletes as a role standing for it, never as the database owner, who passes whatever happens.
 */

const EVENT = 'ca5c0000-0000-4000-8000-0000000000e1';
const ACCOUNT = 'ca5c0000-0000-4000-8000-000000000a01';
const ACCOUNT_PHOTO = 'ca5c0000-0000-4000-8000-000000000b11';
const KEYS = [
  `events/${EVENT}/${ACCOUNT_PHOTO}/original.jpg`,
  `events/${EVENT}/${ACCOUNT_PHOTO}/preview.jpg`,
];
const AUTH_LIKE = 'photo_probe_auth_server';

/** One photo of `sender` ('phone', 'account', 'both' or 'neither') named `name`. */
function insertPhoto(tx, sender, name, id = ACCOUNT_PHOTO) {
  const device = sender === 'phone' || sender === 'both' ? ACCOUNT_PHOTO : null;
  const account = sender === 'account' || sender === 'both' ? ACCOUNT : null;
  return tx`
    INSERT INTO event_photos (id, event_id, status, uploader_name, device_id, uploader_user_id,
                              original_key, preview_key, byte_size, crc32)
    VALUES (${id}, ${EVENT}, 'approved', ${name}, ${device}, ${account},
            ${`events/${EVENT}/${id}/original.jpg`}, ${`events/${EVENT}/${id}/preview.jpg`}, 1, 0)`;
}

async function withAccountPhoto(tx) {
  await tx`INSERT INTO auth.users (id) VALUES (${ACCOUNT})`;
  await insertPhoto(tx, 'account', 'Léa Martin');
}

/** The auth server's delete, as a role that owns nothing, bypasses no RLS and holds no grant on public. */
async function deleteAsAuthServer(tx) {
  await tx.unsafe(`CREATE ROLE ${AUTH_LIKE} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
  await tx.unsafe(`GRANT USAGE ON SCHEMA auth TO ${AUTH_LIKE}`);
  await tx.unsafe(`GRANT SELECT, DELETE ON auth.users TO ${AUTH_LIKE}`);
  await tx.unsafe(`SET LOCAL ROLE ${AUTH_LIKE}`);
  await tx`DELETE FROM auth.users WHERE id = ${ACCOUNT}`;
}

async function accountDeleteRefused({ tryAndRollBack, check }) {
  const { error } = await tryAndRollBack(async (tx) => {
    await withAccountPhoto(tx);
    await deleteAsAuthServer(tx);
  });
  check(
    "the auth server's delete of an account that still has a photo is refused",
    error?.code === '23503',
    error?.message ?? 'the account was deleted',
  );
}

/** Erasure's path: the API deletes her photos as the service role, then the account goes. */
async function erasureThenAccountDelete({ tryAndRollBack, check }) {
  const { error, observed } = await tryAndRollBack(
    async (tx) => {
      await withAccountPhoto(tx);
      await tx`SET LOCAL ROLE service_role`;
      await tx`DELETE FROM event_photos WHERE uploader_user_id = ${ACCOUNT}`;
      await tx`RESET ROLE`;
      await deleteAsAuthServer(tx);
      await tx`RESET ROLE`;
    },
    async (tx) => ({
      photos: (await tx`SELECT count(*)::int AS n FROM event_photos WHERE id = ${ACCOUNT_PHOTO}`)[0]
        .n,
      queued: (
        await tx`SELECT object_key FROM event_photo_tombstones WHERE object_key IN ${tx(KEYS)}`
      ).length,
    }),
  );
  check(
    "erasure's delete of her photos queues both keys, then the account delete goes through",
    error === null && observed.photos === 0 && observed.queued === 2,
    error?.message ?? JSON.stringify(observed),
  );
}

async function oneSenderAndNames({ tryAndRollBack, check }) {
  const cases = [
    ['a photo from a phone and an account is refused', 'both', 'x', true],
    ['a photo from neither a phone nor an account is refused', 'neither', 'x', true],
    ["a phone's 41-character name is refused", 'phone', 'x'.repeat(41), true],
    ["an account's 200-character name is kept", 'account', 'x'.repeat(200), false],
    ["an account's 201-character name is refused", 'account', 'x'.repeat(201), true],
  ];
  for (const [what, sender, name, refused] of cases) {
    const { error } = await tryAndRollBack(async (tx) => {
      await tx`INSERT INTO auth.users (id) VALUES (${ACCOUNT})`;
      await insertPhoto(tx, sender, name);
    });
    check(what, refused ? error?.code === '23514' : error === null, error?.message ?? 'written');
  }
}

/** Seven checks. */
export async function photoAccountCases(probe) {
  await accountDeleteRefused(probe);
  await erasureThenAccountDelete(probe);
  await oneSenderAndNames(probe);
}
