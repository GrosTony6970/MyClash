/**
 * The photo tombstone cases of the cascade probe (migration 0250): every path that removes a photo
 * row queues both its image keys, on COMMITTED rows. A cascade is the path that hides: a club
 * delete reaches the photo through organizations -> events -> event_photos, and no API code runs.
 *
 * The seed (`packages/db/fixtures/cascade-probe-seed.sql`) holds one photo on the probe's Event,
 * tagged with its Tournament. Each case runs in a transaction the probe rolls back; the committed
 * club delete at the end is checked by `tombstonesAfterClubDelete`, which then removes the two
 * tombstones so the probe leaves nothing behind.
 */

export const PHOTO = 'ca5c0000-0000-4000-8000-000000000b01';
const EVENT = 'ca5c0000-0000-4000-8000-0000000000e1';
const TOURNAMENT = 'ca5c0000-0000-4000-8000-0000000000f1';
const CLUB = 'ca5c0000-0000-4000-8000-000000000001';
export const PHOTO_KEYS = [
  `events/${EVENT}/${PHOTO}/original.jpg`,
  `events/${EVENT}/${PHOTO}/preview.jpg`,
];
export const PHOTO_SEEDED = ['event_photos', 'id', PHOTO];
/** A phone's Report of the photo (0252): it goes with the photo on every path. */
const REPORTER = 'ca5c0000-0000-4000-8000-000000000b03';
export const REPORT_SEEDED = ['event_photo_reports', 'device_id', REPORTER];
const BOTH = JSON.stringify([...PHOTO_KEYS].sort());

async function queuedKeys(tx) {
  const rows = await tx`
    SELECT object_key FROM event_photo_tombstones WHERE object_key IN ${tx(PHOTO_KEYS)}
     ORDER BY object_key`;
  return rows.map((row) => row.object_key);
}

async function photoLeft(tx) {
  return (await tx`SELECT count(*)::int AS n FROM event_photos WHERE id = ${PHOTO}`)[0].n;
}

async function reportsLeft(tx) {
  return (await tx`SELECT count(*)::int AS n FROM event_photo_reports WHERE photo_id = ${PHOTO}`)[0]
    .n;
}

/** As the API's role: it deletes Events and photos as `service_role`, through the invoker trigger. */
const asService = (statement) => async (tx) => {
  await tx`SET LOCAL ROLE service_role`;
  await statement(tx);
  await tx`RESET ROLE`;
};

const PATHS = [
  ['a photo delete', (tx) => tx`DELETE FROM event_photos WHERE id = ${PHOTO}`],
  ['the Event delete', (tx) => tx`DELETE FROM events WHERE id = ${EVENT}`],
  ['the club delete', (tx) => tx`DELETE FROM organizations WHERE id = ${CLUB}`],
  // CASCADE: a plain TRUNCATE is refused once the reports' key points at the table (0252).
  ['a TRUNCATE', (tx) => tx`TRUNCATE event_photos CASCADE`],
  ['a TRUNCATE of the clubs, cascading', (tx) => tx`TRUNCATE organizations CASCADE`],
  [
    "a photo delete by the API's role",
    asService((tx) => tx`DELETE FROM event_photos WHERE id = ${PHOTO}`),
  ],
  [
    "the Event delete by the API's role",
    asService((tx) => tx`DELETE FROM events WHERE id = ${EVENT}`),
  ],
];

/** Before any delete: no tombstone of the seed's keys, so a leftover cannot pass for the trigger. */
export async function noTombstoneBeforeDeletes(sql, check) {
  const left = await queuedKeys(sql);
  check('no photo tombstone before the deletes', left.length === 0, left.join(', '));
}

/** The rolled-back cases: each delete path removes the photo and its report, and queues both keys. */
export async function photoTombstoneCases({ tryAndRollBack, check }) {
  for (const [what, statement] of PATHS) {
    const { error, observed } = await tryAndRollBack(statement, async (tx) => ({
      queued: JSON.stringify(await queuedKeys(tx)),
      left: await photoLeft(tx),
      reports: await reportsLeft(tx),
    }));
    check(
      `${what} removes the photo and its report, and queues both its keys`,
      error === null && observed.queued === BOTH && observed.left === 0 && observed.reports === 0,
      error?.message ?? JSON.stringify(observed),
    );
  }
  await tournamentDeleteUntags({ tryAndRollBack, check });
  await secondReportAddsNothing({ tryAndRollBack, check });
  await reportComments({ tryAndRollBack, check });
  await reportChangedAt({ tryAndRollBack, check });
  await webRoleReadsNone({ tryAndRollBack, check });
}

/** A second phone's report of the photo: written and rolled back by `reportChangedAt` only. */
const OTHER_REPORTER = 'ca5c0000-0000-4000-8000-000000000b04';

/**
 * The report's two times, compared in SQL: postgres.js reads a timestamptz as a millisecond Date,
 * which hides a microsecond difference. `first` is text for the same reason.
 */
async function timesOf(tx, device) {
  return (
    await tx`
      SELECT updated_at > created_at AS moved, updated_at = created_at AS same,
             created_at::text AS first
        FROM event_photo_reports WHERE photo_id = ${PHOTO} AND device_id = ${device}`
  )[0];
}

/** The API's write of a Report with a comment (0253, ruling 453). */
const reportWith = (tx, device, comment) => tx`
  INSERT INTO event_photo_reports (photo_id, device_id, comment) VALUES (${PHOTO}, ${device}, ${comment})
  ON CONFLICT (photo_id, device_id) DO UPDATE SET comment = EXCLUDED.comment`;

/**
 * A report's last change (0255, ruling 466): a changed comment moves `updated_at` and leaves the
 * first time; the same words again move nothing; a new report starts with both times equal. The
 * seed's report was committed earlier, so its times are older than any case's now().
 */
async function reportChangedAt({ tryAndRollBack, check }) {
  let before;
  const changed = await tryAndRollBack(
    async (tx) => {
      before = (await timesOf(tx, REPORTER)).first;
      await reportWith(tx, REPORTER, 'this is my child');
    },
    (tx) => timesOf(tx, REPORTER),
  );
  check(
    "a changed comment moves the report's time past its first time, and keeps the first",
    changed.error === null && changed.observed.moved && changed.observed.first === before,
    changed.error?.message ?? JSON.stringify({ before, ...changed.observed }),
  );
  // One transaction shares one now(): the time is set back by hand, which the WHEN lets stick.
  const same = await tryAndRollBack(
    async (tx) => {
      await reportWith(tx, REPORTER, 'a');
      await tx`UPDATE event_photo_reports SET updated_at = created_at WHERE device_id = ${REPORTER}`;
      await reportWith(tx, REPORTER, 'a');
    },
    (tx) => timesOf(tx, REPORTER),
  );
  check(
    'the same comment again leaves the time',
    same.error === null && same.observed.same,
    same.error?.message ?? JSON.stringify(same.observed),
  );
  const fresh = await tryAndRollBack(
    (tx) => reportWith(tx, OTHER_REPORTER, 'this is me'),
    (tx) => timesOf(tx, OTHER_REPORTER),
  );
  check(
    "a new report's two times are equal",
    fresh.error === null && fresh.observed.same,
    fresh.error?.message ?? JSON.stringify(fresh.observed),
  );
}

async function commentOf(tx) {
  return (await tx`SELECT comment FROM event_photo_reports WHERE device_id = ${REPORTER}`).map(
    (row) => row.comment,
  );
}

/**
 * A report's comment (0253): a repeat with a comment replaces it and stays one row (ruling 453);
 * 1 to 200 characters, an empty one refused (the API sends NULL for it).
 */
async function reportComments({ tryAndRollBack, check }) {
  const { error, observed } = await tryAndRollBack(
    (tx) => tx`
      INSERT INTO event_photo_reports (photo_id, device_id, comment)
      VALUES (${PHOTO}, ${REPORTER}, 'please, it is urgent')
      ON CONFLICT (photo_id, device_id) DO UPDATE SET comment = EXCLUDED.comment`,
    commentOf,
  );
  check(
    "a second report's comment replaces the first, in one row",
    error === null && JSON.stringify(observed) === '["please, it is urgent"]',
    error?.message ?? JSON.stringify(observed),
  );
  for (const [what, comment, refused] of [
    ['a comment of 201 characters is refused', 'x'.repeat(201), true],
    ['an empty comment is refused', '', true],
    ['a comment of 200 characters is taken', 'x'.repeat(200), false],
  ]) {
    const { error: written } = await tryAndRollBack(
      (tx) => tx`UPDATE event_photo_reports SET comment = ${comment} WHERE device_id = ${REPORTER}`,
    );
    check(
      what,
      refused ? written?.code === '23514' : written === null,
      written?.message ?? 'written',
    );
  }
}

/** The API's write: the same phone reporting the same photo again leaves one row (0252's key). */
async function secondReportAddsNothing({ tryAndRollBack, check }) {
  const { error, observed } = await tryAndRollBack(
    (tx) => tx`
      INSERT INTO event_photo_reports (photo_id, device_id) VALUES (${PHOTO}, ${REPORTER})
      ON CONFLICT (photo_id, device_id) DO NOTHING`,
    reportsLeft,
  );
  check(
    'a second report by the same phone adds no row',
    error === null && observed === 1,
    error?.message ?? `${observed} rows`,
  );
}

async function tournamentDeleteUntags({ tryAndRollBack, check }) {
  const { error, observed } = await tryAndRollBack(
    (tx) => tx`DELETE FROM tournaments WHERE id = ${TOURNAMENT}`,
    async (tx) => ({
      queued: await queuedKeys(tx),
      photo: await tx`SELECT tournament_id FROM event_photos WHERE id = ${PHOTO}`,
    }),
  );
  check(
    'a Tournament delete keeps the photo, untagged, and queues nothing',
    error === null &&
      observed.queued.length === 0 &&
      observed.photo.length === 1 &&
      observed.photo[0].tournament_id === null,
    error?.message ?? JSON.stringify(observed),
  );
}

async function webRoleReadsNone({ tryAndRollBack, check }) {
  for (const role of ['anon', 'authenticated']) {
    const { error, observed } = await tryAndRollBack(
      async (tx) => {
        await tx`INSERT INTO event_photo_tombstones (object_key) VALUES ('events/probe/web.jpg')`;
        await tx.unsafe(`SET LOCAL ROLE ${role}`);
      },
      async (tx) => (await tx`SELECT count(*)::int AS n FROM event_photo_tombstones`)[0].n,
    );
    check(
      `${role} reads no tombstone`,
      error === null && observed === 0,
      error?.message ?? `${role} read ${observed}`,
    );
  }
}

/**
 * After the seed's club is deleted for real (by the club delete, or by the probe's by-hand
 * fallback, which cascades to the photo too): both keys were queued; then they are removed, so the
 * next run on the same database starts clean.
 */
export async function tombstonesAfterClubDelete(sql, check) {
  const queued = JSON.stringify(await queuedKeys(sql));
  check('the committed club delete queued both photo keys', queued === BOTH, `queued ${queued}`);
  await sql`DELETE FROM event_photo_tombstones WHERE object_key IN ${sql(PHOTO_KEYS)}`;
  const left = await queuedKeys(sql);
  check('no photo tombstone left', left.length === 0, left.join(', '));
}
