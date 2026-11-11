/**
 * What a fighter merge does to FightBook (migration 0265): the scenario of `db-merge-probe.mjs`
 * for the spar requests, the private notes, the blocks and the switch. A block must survive a
 * merge, nobody may end up asking themselves, and no Inbox may hold a request from someone its
 * owner blocked.
 */
import {
  P,
  check,
  id,
  lastMerge,
  merge,
  profile,
  revert,
  scenario,
} from './merge-probe-fixture.mjs';

/** X and Y: two other fighters. */
const X = id(14);
const Y = id(15);
const R = { st: id(61), sx: id(62), tx: id(63), ys: id(64), yt: id(65), sy: id(66) };
const B = { xs: id(71), sy: id(72) };
const NOTE = id(81);

async function seedFightBook(q) {
  await q`INSERT INTO global_persons (id, slug, display_name, given_name, family_name) VALUES
    (${X}, 'fb-x', 'X', 'X', 'Probe'), (${Y}, 'fb-y', 'Y', 'Y', 'Probe')`;
  await q`UPDATE global_persons SET fightbook_enabled = (id <> ${P.source})
    WHERE id IN (${P.source}, ${P.target})`;
  const req = (rid, asker, receiver, status = 'pending') =>
    q`INSERT INTO spar_requests (id, asker_global_person_id, receiver_global_person_id, kind,
        spar_day, zone, place, weapons, status, agreed_at, expires_at)
      VALUES (${rid}, ${asker}, ${receiver}, 'free', '2026-05-22', 'Europe/Paris', 'Salle',
        ARRAY['Longsword'], ${status}, ${status === 'agreed' ? new Date().toISOString() : null},
        now() + interval '1 day')`;
  await req(R.st, P.source, P.target); // between the two: stays
  await req(R.sx, P.source, X); // collides with T→X: stays
  await req(R.tx, P.target, X); // X will block the survivor: ends
  await req(R.ys, Y, P.source); // collides with Y→T: stays
  await req(R.yt, Y, P.target); // the survivor will block Y: ends
  await req(R.sy, P.source, Y, 'agreed'); // an agreed spar: moves, stays agreed
  await q`INSERT INTO fightbook_blocks (id, blocker_global_person_id, blocked_global_person_id)
    VALUES (${B.xs}, ${X}, ${P.source}), (${B.sy}, ${P.source}, ${Y})`;
  await q`INSERT INTO spar_private_notes (id, spar_request_id, author_global_person_id, body)
    VALUES (${NOTE}, ${R.sy}, ${P.source}, 'Good spar')`;
}

const request = (q, rid) =>
  q`SELECT asker_global_person_id AS a, receiver_global_person_id AS r, status
      FROM spar_requests WHERE id = ${rid}`.then((rows) => rows[0]);
const blockOf = (q, bid) =>
  q`SELECT blocker_global_person_id AS by, blocked_global_person_id AS of
      FROM fightbook_blocks WHERE id = ${bid}`.then((rows) => rows[0]);
const noteAuthor = (q) =>
  q`SELECT author_global_person_id AS a FROM spar_private_notes WHERE id = ${NOTE}`.then(
    (rows) => rows[0]?.a,
  );
const switchOf = (q, profileId) =>
  q`SELECT fightbook_enabled AS on FROM global_persons WHERE id = ${profileId}`.then(
    (rows) => rows[0]?.on,
  );

async function checkMerged(q) {
  check('a request between the two stays on the merged profile', await request(q, R.st), {
    a: P.source,
    r: P.target,
    status: 'pending',
  });
  check(
    'a request that would double a waiting one stays (asker)',
    (await request(q, R.sx)).a,
    P.source,
  );
  check(
    'a request that would double a waiting one stays (receiver)',
    (await request(q, R.ys)).r,
    P.source,
  );
  check('an agreed spar moves and stays agreed', await request(q, R.sy), {
    a: P.target,
    r: Y,
    status: 'agreed',
  });
  check('a block aimed at the merged profile moves', await blockOf(q, B.xs), {
    by: X,
    of: P.target,
  });
  check('a block the merged profile made moves', await blockOf(q, B.sy), { by: P.target, of: Y });
  check(
    'a waiting request to someone who now blocks the survivor ends',
    (await request(q, R.tx)).status,
    'not_this_time',
  );
  check(
    'a waiting request from someone the survivor now blocks ends',
    (await request(q, R.yt)).status,
    'not_this_time',
  );
  check('a private note moves', await noteAuthor(q), P.target);
  check('the survivor keeps the stricter switch', await switchOf(q, P.target), false);
}

export async function fightBookMovesWithTheMerge(tx) {
  await scenario(tx, async (q) => {
    await seedFightBook(q);
    await merge(q, P.source, P.target);
    await checkMerged(q);
    const record = await lastMerge(q, P.source);
    const { moved } = record.payload_json;
    check(
      'the record lists what moved',
      [
        moved.sparRequestAskerIds,
        moved.sparRequestReceiverIds,
        moved.blockBlockerIds,
        moved.blockBlockedIds,
        moved.sparNoteIds,
      ],
      [[R.sy], [], [B.sy], [B.xs], [NOTE]],
    );
    await revert(q, record.id);
    check('the spar moves back', (await request(q, R.sy)).a, P.source);
    check(
      'the blocks move back',
      [(await blockOf(q, B.xs)).of, (await blockOf(q, B.sy)).by],
      [P.source, P.source],
    );
    check('the note moves back', await noteAuthor(q), P.source);
    check('an ended request stays ended', (await request(q, R.tx)).status, 'not_this_time');
    check('the survivor keeps its switch', await switchOf(q, P.target), false);
  });
}
