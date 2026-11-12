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
const spar = (q, asker, receiver, { status = 'done', endedHoursAgo = 240, ...more } = {}) =>
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

const refusedWith = async (q, call) => {
  const raised = await refusal(q, call);
  return raised ? (raised.code ?? raised.message) : null;
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
  await reviewTexts(tx);
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
    await review(q, c, F.marc, 4);
    // 5 + 4 + 4 = 13 / 3: the third review moves the line at once (ruling 688).
    check('a third review moves the line at once', await starLine(q, F.julie), {
      average: Math.round((13 / 3) * 10) / 10,
      count: 3,
    });
  });
}

// ── The CHECKs of the new tables ────────────────────────────────────────────
export async function reviewTableShape(tx) {
  await scenario(tx, async (q) => {
    check(
      'done with a cancel field',
      await refusedWith(q, (sp) =>
        spar(sp, F.marc, F.julie, { cancelled_by: F.marc, cancel_message: 'no' }),
      ),
      '23514',
    );
    const done = await spar(q, F.marc, F.julie);
    check('zero stars', await refusedWith(q, (sp) => review(sp, done, F.marc, 0)), '23514');
    check('six stars', await refusedWith(q, (sp) => review(sp, done, F.marc, 6)), '23514');
    check(
      'reviewing yourself',
      await refusedWith(
        q,
        (sp) =>
          sp`INSERT INTO spar_thanks (spar_request_id, author_global_person_id,
              subject_global_person_id, stars) VALUES (${done}, ${F.marc}, ${F.marc}, 3)`,
      ),
      '23514',
    );
    check(
      'favouriting yourself',
      await refusedWith(
        q,
        (sp) =>
          sp`INSERT INTO fightbook_favourites (owner_global_person_id, favourite_global_person_id)
              VALUES (${F.marc}, ${F.marc})`,
      ),
      '23514',
    );
  });
}

export const REVIEW_FUNCTIONS = [
  'public.fightbook_review(uuid, uuid, smallint, text, boolean, timestamp with time zone)',
  'public.fightbook_star_line(uuid)',
];
