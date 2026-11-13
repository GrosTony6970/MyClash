/**
 * The scenarios of `scripts/db-fightbook-probe.mjs` for slice 3 (migration 0267): `fightbook_review`
 * and `fightbook_star_line`, and the CHECKs of the three new tables. Same transaction, same
 * savepoints, same service role as the slice 1 scenarios.
 */
import { F } from './fightbook-probe-scenarios.mjs';
import { check, refusal, scenario } from './merge-probe-fixture.mjs';

const DAY = '2026-05-22';
const HOUR = 3_600_000;
const ago = (hours) => new Date(Date.now() - hours * HOUR).toISOString();

/** A spar seeded straight into a status, its end `endedHoursAgo` hours back (the CHECK wants `agreed_at`). */
export const spar = (q, asker, receiver, { status = 'done', endedHoursAgo = 240, ...more } = {}) =>
  q`INSERT INTO spar_requests ${q({
    asker_global_person_id: asker,
    receiver_global_person_id: receiver,
    kind: 'event',
    spar_day: DAY,
    zone: 'Europe/Paris',
    weapons: ['Longsword'],
    expires_at: ago(endedHoursAgo),
    status,
    agreed_at: new Date().toISOString(),
    ...more,
  })} RETURNING id`.then((rows) => rows[0].id);

const review = (q, request, author, stars, { body = null, anonymous = false, now } = {}) =>
  q`SELECT public.fightbook_review(${request}, ${author}, ${stars}::smallint, ${body}, ${anonymous},
      ${now ?? new Date().toISOString()}::timestamptz)`;

/** The name of the CHECK a call broke: a name, not 23514, so another CHECK cannot stand in. */
export const brokenCheck = async (q, call) => {
  const raised = await refusal(q, call);
  if (!raised) return null;
  const named = /check constraint "([^"]+)"/.exec(raised.message);
  return named ? named[1] : `${raised.code} ${raised.message}`;
};

const reviewRefusal = async (q, call) => {
  const raised = await refusal(q, call);
  return raised ? raised.message : null;
};

const rowsOf = async (q, table, request) =>
  (await q`SELECT count(*)::int AS n FROM ${q(table)} WHERE spar_request_id = ${request}`)[0].n;

const starLine = (q, subject) =>
  // jsonb orders keys by length, so rebuild the object in the order the checks write it.
  q`SELECT public.fightbook_star_line(${subject}) AS r`.then(({ 0: { r } }) => ({
    average: r.average,
    count: r.count,
  }));

// ── Who may review, and when ────────────────────────────────────────────────
export async function reviewing(tx) {
  await scenario(tx, async (q) => {
    const done = await spar(q, F.marc, F.julie);
    // One clock: the row ended 240 h ago, so the database clock is long past the window; the
    // API's clock (p_now) says 47 h after the end, and p_now alone decides.
    const early = new Date(Date.now() - 240 * HOUR + 47 * HOUR).toISOString();
    check(
      'a review before 48 h after the end, the database clock past it',
      await reviewRefusal(q, (sp) => review(sp, done, F.marc, 5, { now: early })),
      'not_open',
    );
    const agreed = await spar(q, F.marc, F.paul, { status: 'agreed' });
    check(
      'a review of a spar that is agreed, not done',
      await reviewRefusal(q, (sp) => review(sp, agreed, F.marc, 5)),
      'not_open',
    );
    check(
      'a stranger reviewing',
      await reviewRefusal(q, (sp) => review(sp, done, F.paul, 5)),
      'not_open',
    );
  });
  await scenario(tx, async (q) => {
    const first = await spar(q, F.marc, F.julie);
    await review(q, first, F.marc, 4, { body: 'Thanks' });
    check(
      'a signed review, then an anonymous one by the same author',
      await reviewRefusal(q, (sp) => review(sp, first, F.marc, 4, { anonymous: true })),
      'not_open',
    );
    const second = await spar(q, F.paul, F.julie);
    await review(q, second, F.paul, 4, { anonymous: true });
    check(
      'an anonymous review, then a signed one by the same author',
      await reviewRefusal(q, (sp) => review(sp, second, F.paul, 4)),
      'not_open',
    );
  });
  await reviewWindow(tx);
  await reviewAuthorLive(tx);
  await reviewTexts(tx);
}

/** The window is [expires_at + 48 h, ...) on p_now alone: the row ends in the FUTURE of the database clock. */
async function reviewWindow(tx) {
  await scenario(tx, async (q) => {
    const done = await spar(q, F.marc, F.julie, { endedHoursAgo: -24 });
    const [{ expires_at: end }] = await q`SELECT expires_at FROM spar_requests WHERE id = ${done}`;
    const opens = end.getTime() + 48 * HOUR;
    const at = (ms) => new Date(ms).toISOString();
    check(
      'a review 1 ms before 48 h after the end',
      await reviewRefusal(q, (sp) => review(sp, done, F.marc, 5, { now: at(opens - 1) })),
      'not_open',
    );
    check(
      'a review exactly 48 h after the end, the database clock before it',
      await reviewRefusal(q, (sp) => review(sp, done, F.marc, 5, { now: at(opens) })),
      null,
    );
  });
}

/** Decision 4: a merged, deleted or erased author writes nothing. */
async function reviewAuthorLive(tx) {
  const gone = [
    ['merged away', `merged_into_id = '${F.paul}'`],
    ['deleted', 'deleted_at = now()'],
    ['erased', 'account_deleted_at = now()'],
  ];
  for (const [label, set] of gone) {
    await scenario(tx, async (q) => {
      const done = await spar(q, F.marc, F.julie);
      await q.unsafe(`UPDATE global_persons SET ${set} WHERE id = '${F.marc}'`);
      check(
        `a review by an author who is ${label}`,
        await reviewRefusal(q, (sp) => review(sp, done, F.marc, 5)),
        'not_open',
      );
    });
  }
}

async function reviewTexts(tx) {
  await scenario(tx, async (q) => {
    const done = await spar(q, F.marc, F.julie);
    await review(q, done, F.marc, 3, { body: 'It stays anonymous', anonymous: true });
    check(
      'an anonymous review with a text is one anonymous row and no thank-you',
      [await rowsOf(q, 'spar_anonymous_reviews', done), await rowsOf(q, 'spar_thanks', done)],
      [1, 0],
    );
    await review(q, done, F.julie, 3, { body: '   ' });
    const [{ body }] = await q`SELECT body FROM spar_thanks WHERE spar_request_id = ${done}`;
    check('a signed review with a blank text keeps no text', body, null);
    const other = await spar(q, F.paul, F.julie);
    await review(q, other, F.paul, 3, { body: ' Thanks ' });
    const [kept] = await q`SELECT body FROM spar_thanks WHERE spar_request_id = ${other}`;
    check('a signed text is kept, trimmed', kept.body, 'Thanks');
  });
}

// ── The star line ───────────────────────────────────────────────────────────
export async function starLineMoves(tx) {
  await scenario(tx, async (q) => {
    check('no review yet', await starLine(q, F.julie), { average: null, count: 0 });
    const a = await spar(q, F.marc, F.julie);
    const b = await spar(q, F.paul, F.julie);
    await review(q, a, F.marc, 5);
    await review(q, b, F.paul, 4, { anonymous: true });
    check('two reviews, one in each table, count both', await starLine(q, F.julie), {
      average: 4.5,
      count: 2,
    });
    const c = await spar(q, F.julie, F.marc, { endedHoursAgo: 300 });
    await review(q, c, F.marc, 5);
    // 5 + 4 + 5 = 14 / 3 = 4.67: rounds to 4.7 (a truncation would say 4.6); the third review
    // moves the line at once (ruling 688).
    const julies = { average: 4.7, count: 3 };
    check('a third review moves the line at once', await starLine(q, F.julie), julies);
    // A review ABOUT Marc (Julie writes it): the line counts its subject's reviews only.
    const d = await spar(q, F.julie, F.marc, { endedHoursAgo: 310 });
    await review(q, d, F.julie, 1);
    check(
      'a review about another fighter leaves the line alone',
      await starLine(q, F.julie),
      julies,
    );
    check('and is that fighter’s own line', await starLine(q, F.marc), { average: 1, count: 1 });
  });
}

// ── The CHECKs of the new tables ────────────────────────────────────────────
export async function reviewTableShape(tx) {
  await scenario(tx, async (q) => {
    check(
      'done with a cancel field',
      await brokenCheck(q, (sp) => spar(sp, F.marc, F.julie, { cancelled_by: 'receiver' })),
      'spar_requests_status_shape',
    );
    const done = await spar(q, F.marc, F.julie);
    check(
      'zero stars',
      await brokenCheck(q, (sp) => review(sp, done, F.marc, 0)),
      'spar_thanks_stars',
    );
    check(
      'six stars',
      await brokenCheck(q, (sp) => review(sp, done, F.marc, 6)),
      'spar_thanks_stars',
    );
    check(
      'reviewing yourself',
      await brokenCheck(
        q,
        (sp) =>
          sp`INSERT INTO spar_thanks (spar_request_id, author_global_person_id,
              subject_global_person_id, stars) VALUES (${done}, ${F.marc}, ${F.marc}, 3)`,
      ),
      'spar_thanks_two_fighters',
    );
    check(
      'favouriting yourself',
      await brokenCheck(
        q,
        (sp) =>
          sp`INSERT INTO fightbook_favourites (owner_global_person_id, favourite_global_person_id)
              VALUES (${F.marc}, ${F.marc})`,
      ),
      'fightbook_favourites_two_fighters',
    );
  });
}

export const REVIEW_FUNCTIONS = [
  'public.fightbook_review(uuid, uuid, smallint, text, boolean, timestamp with time zone)',
  'public.fightbook_star_line(uuid)',
];
