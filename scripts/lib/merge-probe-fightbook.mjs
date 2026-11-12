/**
 * What a fighter merge does to FightBook (migrations 0265 and 0268): the scenario of
 * `db-merge-probe.mjs` for the spar requests, the private notes, the blocks, the thank-yous, the
 * anonymous reviews, the favourites and the two switches. A block must survive a merge, nobody may
 * end up asking, reviewing or favouriting themselves, no Inbox may hold a request from someone its
 * owner blocked, and the survivor's star line must count the stars the merged profile was given.
 */
import { P, check, id, lastMerge, merge, revert, scenario } from './merge-probe-fixture.mjs';

/** X, Y and Z: three other fighters. */
const X = id(14);
const Y = id(15);
const Z = id(16);
const R = {
  st: id(61),
  sx: id(62),
  tx: id(63),
  ys: id(64),
  yt: id(65),
  sy: id(66),
  ds: id(67),
  dx: id(68),
  dt: id(69),
  dy: id(70),
};
const B = { xs: id(71), sy: id(72) };
const NOTE = id(81);
/** Thank-yous, anonymous reviews and favourites (0267), named writer/owner then subject. */
const TH = { ys: id(91), sy: id(92), st: id(93), yt: id(96) };
const AN = { xs: id(94), sx: id(95), ty: id(97) };
const FAV = {
  sx: id(101),
  ys: id(102),
  ts: id(103),
  st: id(104),
  sy: id(105),
  ty: id(106),
  xs: id(107),
  xt: id(108),
  sz: id(109),
  zs: id(110),
};
/** Favourites on the merged profile whose insert lands just after the merge (a race). */
const LATE = { sz: id(111), zs: id(112) };

/** Agreed, done and cancelled spars carry `agreed_at`; the others never do (the status CHECK). */
const AGREED = new Set(['agreed', 'done', 'cancelled']);
const req = (q, rid, asker, receiver, status = 'pending') =>
  q`INSERT INTO spar_requests (id, asker_global_person_id, receiver_global_person_id, kind,
      spar_day, zone, place, weapons, status, agreed_at, expires_at)
    VALUES (${rid}, ${asker}, ${receiver}, 'free', '2026-05-22', 'Europe/Paris', 'Salle',
      ARRAY['Longsword'], ${status},
      ${AGREED.has(status) ? new Date().toISOString() : null}, now() + interval '1 day')`;

async function seedFightBook(q) {
  await q`INSERT INTO global_persons (id, slug, display_name, given_name, family_name) VALUES
    (${X}, 'fb-x', 'X', 'X', 'Probe'), (${Y}, 'fb-y', 'Y', 'Y', 'Probe')`;
  await q`UPDATE global_persons SET fightbook_enabled = (id <> ${P.source})
    WHERE id IN (${P.source}, ${P.target})`;
  await req(q, R.st, P.source, P.target); // between the two: stays
  await req(q, R.sx, P.source, X); // collides with T→X: stays
  await req(q, R.tx, P.target, X); // X will block the survivor: ends
  await req(q, R.ys, Y, P.source); // collides with Y→T: stays
  await req(q, R.yt, Y, P.target); // the survivor will block Y: ends
  await req(q, R.sy, P.source, Y, 'agreed'); // an agreed spar: moves, stays agreed
  await q`INSERT INTO fightbook_blocks (id, blocker_global_person_id, blocked_global_person_id)
    VALUES (${B.xs}, ${X}, ${P.source}), (${B.sy}, ${P.source}, ${Y})`;
  await q`INSERT INTO spar_private_notes (id, spar_request_id, author_global_person_id, body)
    VALUES (${NOTE}, ${R.sy}, ${P.source}, 'Good spar')`;
}

/** Four done spars (two with Y, one with X, one between the two), reviews, favourites, switch. */
async function seedAfterTheSpar(q) {
  await q`INSERT INTO global_persons (id, slug, display_name, given_name, family_name)
    VALUES (${Z}, 'fb-z', 'Z', 'Z', 'Probe')`;
  await q`UPDATE global_persons SET fightbook_show_stars = (id <> ${P.source})
    WHERE id IN (${P.source}, ${P.target})`;
  await req(q, R.ds, Y, P.source, 'done');
  await req(q, R.dx, P.source, X, 'done');
  await req(q, R.dt, P.source, P.target, 'done'); // between the two: stays, with its thank-you
  await req(q, R.dy, Y, P.source, 'done'); // reviewed only after the merge
  await q`INSERT INTO spar_thanks (id, spar_request_id, author_global_person_id,
      subject_global_person_id, stars, body) VALUES
    (${TH.ys}, ${R.ds}, ${Y}, ${P.source}, 5, 'Thanks'),
    (${TH.sy}, ${R.ds}, ${P.source}, ${Y}, 3, NULL),
    (${TH.st}, ${R.dt}, ${P.source}, ${P.target}, 4, NULL)`;
  await q`INSERT INTO spar_anonymous_reviews (id, spar_request_id, author_global_person_id,
      subject_global_person_id, stars) VALUES
    (${AN.xs}, ${R.dx}, ${X}, ${P.source}, 2),
    (${AN.sx}, ${R.dx}, ${P.source}, ${X}, 1)`;
  await q`INSERT INTO fightbook_favourites (id, owner_global_person_id, favourite_global_person_id)
    VALUES (${FAV.sx}, ${P.source}, ${X}), (${FAV.ys}, ${Y}, ${P.source}),
      (${FAV.ts}, ${P.target}, ${P.source}), (${FAV.st}, ${P.source}, ${P.target}),
      (${FAV.sy}, ${P.source}, ${Y}), (${FAV.ty}, ${P.target}, ${Y}),
      (${FAV.xs}, ${X}, ${P.source}), (${FAV.xt}, ${X}, ${P.target}),
      (${FAV.sz}, ${P.source}, ${Z}), (${FAV.zs}, ${Z}, ${P.source})`;
}

/**
 * Between the merge and the revert: Y thanks the survivor and the survivor reviews Y on the
 * merged profile's spar R.dy, and two favourites on the merged profile land late (their checks
 * passed before the merge, their inserts after it).
 */
async function writeAfterTheMerge(q) {
  await q`INSERT INTO spar_thanks (id, spar_request_id, author_global_person_id,
      subject_global_person_id, stars) VALUES (${TH.yt}, ${R.dy}, ${Y}, ${P.target}, 1)`;
  await q`INSERT INTO spar_anonymous_reviews (id, spar_request_id, author_global_person_id,
      subject_global_person_id, stars) VALUES (${AN.ty}, ${R.dy}, ${P.target}, ${Y}, 4)`;
  await q`INSERT INTO fightbook_favourites (id, owner_global_person_id, favourite_global_person_id)
    VALUES (${LATE.sz}, ${P.source}, ${Z}), (${LATE.zs}, ${Z}, ${P.source})`;
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
const starSwitchOf = (q, profileId) =>
  q`SELECT fightbook_show_stars AS on FROM global_persons WHERE id = ${profileId}`.then(
    (rows) => rows[0]?.on,
  );
/** Each review as { by, of }, in the order of `ids`. */
const reviews = (q, table, ids) =>
  q`SELECT author_global_person_id AS by, subject_global_person_id AS of
      FROM ${q(table)} WHERE id = ANY(${ids}::uuid[])
      ORDER BY array_position(${ids}::uuid[], id)`.then((rows) =>
    rows.map(({ by, of }) => ({ by, of })),
  );
const favourites = (q, ids) =>
  q`SELECT owner_global_person_id AS by, favourite_global_person_id AS of
      FROM fightbook_favourites WHERE id = ANY(${ids}::uuid[])
      ORDER BY array_position(${ids}::uuid[], id)`.then((rows) =>
    rows.map(({ by, of }) => ({ by, of })),
  );
const starLine = (q, subject) =>
  // jsonb orders keys by length, so rebuild the object in the order the checks write it.
  q`SELECT public.fightbook_star_line(${subject}) AS r`.then(({ 0: { r } }) => ({
    average: r.average,
    count: r.count,
  }));

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

async function checkMergedAfterTheSpar(q) {
  check('a thank-you moves, given or received', await reviews(q, 'spar_thanks', [TH.ys, TH.sy]), [
    { by: Y, of: P.target },
    { by: P.target, of: Y },
  ]);
  check('a thank-you on a spar between the two stays', await reviews(q, 'spar_thanks', [TH.st]), [
    { by: P.source, of: P.target },
  ]);
  check(
    'an anonymous review moves, given or received',
    await reviews(q, 'spar_anonymous_reviews', [AN.xs, AN.sx]),
    [
      { by: X, of: P.target },
      { by: P.target, of: X },
    ],
  );
  // Y's 5 and X's 2 moved to the survivor; the 4 the merged profile gave the survivor (on their
  // spar between the two) was about the survivor already.
  check('the survivor star line counts what moved', await starLine(q, P.target), {
    average: 3.7,
    count: 3,
  });
  check('the survivor keeps the stricter star switch', await starSwitchOf(q, P.target), false);
}

async function checkFavouritesMerged(q) {
  check(
    'a favourite moves, made or received',
    await favourites(q, [FAV.sx, FAV.ys, FAV.sz, FAV.zs]),
    [
      { by: P.target, of: X },
      { by: Y, of: P.target },
      { by: P.target, of: Z },
      { by: Z, of: P.target },
    ],
  );
  check(
    'a favourite between the two stays, never a self pair',
    await favourites(q, [FAV.ts, FAV.st]),
    [
      { by: P.target, of: P.source },
      { by: P.source, of: P.target },
    ],
  );
  check(
    'a favourite the survivor already holds stays, not doubled',
    await favourites(q, [FAV.sy, FAV.ty]),
    [
      { by: P.source, of: Y },
      { by: P.target, of: Y },
    ],
  );
  check(
    'a favourite from someone who favourites both stays, not doubled',
    await favourites(q, [FAV.xs, FAV.xt]),
    [
      { by: X, of: P.source },
      { by: X, of: P.target },
    ],
  );
}

async function checkRevertedAfterTheSpar(q) {
  check('the thank-yous move back', await reviews(q, 'spar_thanks', [TH.ys, TH.sy, TH.st]), [
    { by: Y, of: P.source },
    { by: P.source, of: Y },
    { by: P.source, of: P.target },
  ]);
  check(
    'the anonymous reviews move back',
    await reviews(q, 'spar_anonymous_reviews', [AN.xs, AN.sx]),
    [
      { by: X, of: P.source },
      { by: P.source, of: X },
    ],
  );
  check(
    'a review written on a moved spar after the merge goes back with the spar',
    [await reviews(q, 'spar_thanks', [TH.yt]), await reviews(q, 'spar_anonymous_reviews', [AN.ty])],
    [[{ by: Y, of: P.source }], [{ by: P.source, of: Y }]],
  );
  check('the favourites move back', await favourites(q, [FAV.sx, FAV.ys]), [
    { by: P.source, of: X },
    { by: Y, of: P.source },
  ]);
  check(
    'a favourite the restored profile got again late stays on the survivor',
    await favourites(q, [FAV.sz, FAV.zs, LATE.sz, LATE.zs]),
    [
      { by: P.target, of: Z },
      { by: Z, of: P.target },
      { by: P.source, of: Z },
      { by: Z, of: P.source },
    ],
  );
  // The source: Y's 5, X's 2 and Y's late 1. The survivor: the merged profile's 4 only.
  check(
    'the star lines split again',
    [await starLine(q, P.source), await starLine(q, P.target)],
    [
      { average: 2.7, count: 3 },
      { average: 4, count: 1 },
    ],
  );
  check('the survivor keeps its star switch', await starSwitchOf(q, P.target), false);
}

export async function fightBookMovesWithTheMerge(tx) {
  await scenario(tx, async (q) => {
    await seedFightBook(q);
    await seedAfterTheSpar(q);
    await merge(q, P.source, P.target);
    await checkMerged(q);
    await checkMergedAfterTheSpar(q);
    await checkFavouritesMerged(q);
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
        moved.sparThanksIds,
        moved.sparAnonymousReviewIds,
        moved.favouriteOwnerIds,
        moved.favouriteTargetIds,
      ],
      [
        [R.sy, R.dx],
        [R.ds, R.dy],
        [B.sy],
        [B.xs],
        [NOTE],
        [TH.ys, TH.sy],
        [AN.xs, AN.sx],
        [FAV.sx, FAV.sz],
        [FAV.ys, FAV.zs],
      ],
    );
    await writeAfterTheMerge(q);
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
    await checkRevertedAfterTheSpar(q);
  });
}
