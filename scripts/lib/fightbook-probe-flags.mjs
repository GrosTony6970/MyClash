/**
 * The scenarios of `scripts/db-fightbook-probe.mjs` for slice 4 (migration 0269), part one: the
 * seed and helpers the flag checks share, then `fightbook_flag` (the write),
 * `fightbook_profile_family` and `fightbook_flag_shown` (the one owner of "who must never read this
 * flag"). The readers are in fightbook-probe-flag-readers.mjs. Same transaction, same savepoints,
 * same service role as the slice 1 scenarios.
 */
import { F, U } from './fightbook-probe-scenarios.mjs';
import { spar } from './fightbook-probe-reviews.mjs';
import { check, id, refusal, scenario, words } from './merge-probe-fixture.mjs';

export const ORG = id(20);
export const EVENT = id(21);
export const ORG2 = id(230);
export const EVENT_OF_ORG2 = id(232);
export const EVENT_TO_DELETE = id(231);
export const NOW = '2031-01-02T03:04:05.000Z';

/** Accounts: club members, a super admin, a platform admin, and two that claim the extra profiles. */
export const A = {
  adminOne: id(101),
  owner: id(102),
  referee: id(103),
  root: id(104),
  platAdmin: id(105),
  a1: id(106),
  a2: id(107),
};
/** Extra profiles, unclaimed: the merge scenarios claim and merge them. */
export const G = { s: id(111), t: id(112), x: id(113) };

export async function seedFlags(tx) {
  await tx`INSERT INTO auth.users (id) SELECT unnest(${Object.values(A)}::uuid[])`;
  await tx`INSERT INTO organizations (id, slug, name) VALUES (${ORG2}, 'fightbook-probe-two', 'FightBook Probe Two')`;
  await tx`INSERT INTO events (id, organization_id, slug, name, start_date, end_date) VALUES
    (${EVENT_TO_DELETE}, ${ORG}, 'fb-probe-gone', 'Probe Gone', '2026-05-22', '2026-05-22'),
    (${EVENT_OF_ORG2}, ${ORG2}, 'fb-probe-two', 'Probe Two', '2026-05-22', '2026-05-22')`;
  await tx`INSERT INTO global_persons (id, slug, display_name, given_name, family_name) VALUES
    (${G.s}, 'fb-s', 'S', 'S', 'Probe'), (${G.t}, 'fb-t', 'T', 'T', 'Probe'),
    (${G.x}, 'fb-x', 'X', 'X', 'Probe')`;
  await tx`INSERT INTO platform_roles (user_id, role) VALUES
    (${A.root}, 'super_admin'), (${A.platAdmin}, 'platform_admin')`;
}

// ── Calls ───────────────────────────────────────────────────────────────────
/** A spar on Event A, seeded straight into a status (a `cancelled` one needs its canceller). */
export const eventSpar = (q, asker, receiver, { status = 'agreed', ...more } = {}) =>
  spar(q, asker, receiver, {
    status,
    event_id: EVENT,
    weapons: ['Longsword', 'Sabre'],
    ...(status === 'cancelled' ? { cancelled_by: 'asker' } : {}),
    ...(['pending', 'withdrawn', 'not_this_time'].includes(status) ? { agreed_at: null } : {}),
    ...more,
  });

export const flag = (
  q,
  request,
  reporter,
  { reason = 'too_hard', body = 'It hurt', now = NOW } = {},
) =>
  q`SELECT public.fightbook_flag(${request}, ${reporter}, ${reason}, ${body}, ${now}::timestamptz) AS r`.then(
    (rows) => rows[0].r,
  );

/** A flag row written straight, as the function would (the account that held the subject, unless given). */
export async function rawFlag(
  q,
  {
    subject,
    reporter = subject === F.julie ? F.marc : F.julie,
    org = ORG,
    at = NOW,
    holder,
    request = null,
  },
) {
  const [{ id: flagId }] = await q`INSERT INTO spar_flags
      (spar_request_id, reporter_global_person_id, subject_global_person_id, kind, organization_id, spar_day,
       weapons, reason, body, created_at)
    VALUES (${request}, ${reporter}, ${subject}, 'event', ${org}, '2026-05-22', ARRAY['Longsword'],
      'too_hard', 'It hurt', ${at}::timestamptz) RETURNING id`;
  await q`INSERT INTO spar_flag_admin (flag_id, subject_user_id) VALUES (${flagId},
    ${holder === undefined ? q`(SELECT claimed_by_user_id FROM global_persons WHERE id = ${subject})` : holder})`;
  return flagId;
}

export const shown = (q, flagId, caller, club) =>
  q`SELECT public.fightbook_flag_shown(${flagId}, ${caller}, ${club}) AS r`.then(
    (rows) => rows[0].r,
  );

/** Moves a claim without ever leaving two profiles on one account (the index is not deferrable). */
export const claim = (q, profile, account) =>
  q`UPDATE global_persons SET claimed_by_user_id = ${account} WHERE id = ${profile}`;

export const mergeInto = (q, source, target) =>
  q`UPDATE global_persons SET merged_into_id = ${target} WHERE id = ${source}`;

const family = (q, ...ids) =>
  q`SELECT public.fightbook_profile_family(${ids}::uuid[]) AS r`.then((rows) =>
    [...rows[0].r].sort(),
  );

const notOpen = words('P0001', 'not_open');
const flagRows = (q, request) =>
  q`SELECT count(*)::int AS n FROM spar_flags WHERE spar_request_id = ${request}`.then(
    (rows) => rows[0].n,
  );

// ── fightbook_flag ──────────────────────────────────────────────────────────
export async function flagWrites(tx) {
  for (const status of ['agreed', 'done', 'cancelled']) {
    await scenario(tx, async (q) => {
      const request = await eventSpar(q, F.marc, F.julie, { status });
      const flagId = await flag(q, request, F.julie, { reason: 'equipment', body: '  It hurt  ' });
      const [row] =
        await q`SELECT f.spar_request_id AS request, f.reporter_global_person_id AS reporter,
          f.subject_global_person_id AS subject, f.kind, f.event_id AS event,
          f.organization_id AS org, f.spar_day::text AS day, f.place, f.weapons, f.reason, f.body,
          f.created_at, a.subject_user_id AS holder, a.handled_at
        FROM spar_flags f JOIN spar_flag_admin a ON a.flag_id = f.id WHERE f.id = ${flagId}`;
      check(
        `a flag on a ${status} spar: the request's snapshot, the trimmed text, the API's clock, the flagged account`,
        { ...row, created_at: row.created_at.toISOString() },
        {
          request,
          reporter: F.julie,
          subject: F.marc,
          kind: 'event',
          event: EVENT,
          org: ORG,
          day: '2026-05-22',
          place: null,
          weapons: ['Longsword', 'Sabre'],
          reason: 'equipment',
          body: 'It hurt',
          created_at: NOW,
          holder: U.marc,
          handled_at: null,
        },
      );
    });
  }
  await freeDateFlag(tx);
  await flagRefusals(tx);
  await flagLiveness(tx);
  await flagTwice(tx);
  await flagByMergedProfile(tx);
}

async function freeDateFlag(tx) {
  await scenario(tx, async (q) => {
    const request = await spar(q, F.marc, F.julie, {
      kind: 'free',
      place: 'Salle',
      event_id: null,
    });
    const flagId = await flag(q, request, F.julie);
    const [row] =
      await q`SELECT kind, event_id AS event, organization_id AS org, place FROM spar_flags WHERE id = ${flagId}`;
    check('a flag on a free-date spar: no Event, no club, the place', row, {
      kind: 'free',
      event: null,
      org: null,
      place: 'Salle',
    });
  });
}

async function flagRefusals(tx) {
  for (const status of ['pending', 'not_this_time', 'withdrawn']) {
    await scenario(tx, async (q) => {
      const request = await eventSpar(q, F.marc, F.julie, { status });
      check(
        `a flag on a ${status} spar`,
        await refusal(q, (sp) => flag(sp, request, F.julie)),
        notOpen,
      );
    });
  }
  await scenario(tx, async (q) => {
    const request = await eventSpar(q, F.marc, F.julie);
    check('a stranger flagging', await refusal(q, (sp) => flag(sp, request, F.paul)), notOpen);
    check(
      'a flag on an unknown request',
      await refusal(q, (sp) => flag(sp, id(999), F.julie)),
      notOpen,
    );
    await mergeInto(q, F.julie, F.paul);
    check(
      'a merged-away reporter flagging',
      await refusal(q, (sp) => flag(sp, request, F.julie)),
      notOpen,
    );
  });
}

/** Both fighters live: a deleted or erased reporter writes nothing, and nobody flags one. */
async function flagLiveness(tx) {
  for (const [who, profile] of [
    ['reporter', F.julie],
    ['subject', F.marc],
  ])
    for (const column of ['deleted_at', 'account_deleted_at'])
      await scenario(tx, async (q) => {
        const request = await eventSpar(q, F.marc, F.julie);
        await q.unsafe(`UPDATE global_persons SET ${column} = now() WHERE id = '${profile}'`);
        check(
          `a flag with the ${who}'s ${column} set`,
          await refusal(q, (sp) => flag(sp, request, F.julie)),
          notOpen,
        );
      });
}

async function flagTwice(tx) {
  await scenario(tx, async (q) => {
    const request = await eventSpar(q, F.marc, F.julie);
    const first = await flag(q, request, F.julie);
    check('a second flag by the same reporter answers null', await flag(q, request, F.julie), null);
    check('and leaves one row', [typeof first, await flagRows(q, request)], ['string', 1]);
    const partners = await flag(q, request, F.marc);
    const [{ subject }] =
      await q`SELECT subject_global_person_id AS subject FROM spar_flags WHERE id = ${partners}`;
    check(
      'the partner flags the same spar: its own row, about the first reporter',
      [partners !== first, await flagRows(q, request), subject],
      [true, 2, F.julie],
    );
  });
}

/** A profile merged into the reporter flagged this spar before the merge: the reporter's own flag is the second. */
async function flagByMergedProfile(tx) {
  await scenario(tx, async (q) => {
    const request = await eventSpar(q, F.marc, F.julie);
    await rawFlag(q, { subject: F.marc, reporter: G.s, request });
    await mergeInto(q, G.s, F.julie);
    check(
      'a flag by the reporter after a profile merged into hers flagged it: null, one row',
      [await flag(q, request, F.julie), await flagRows(q, request)],
      [null, 1],
    );
  });
}

// ── fightbook_profile_family ────────────────────────────────────────────────
export async function profileFamily(tx) {
  await scenario(tx, async (q) => {
    check('a lone profile is its own family', await family(q, G.s), [G.s]);
    await mergeInto(q, G.s, G.t);
    const both = [G.s, G.t].sort();
    check('S merged into T: {S, T} from S', await family(q, G.s), both);
    check('S merged into T: {S, T} from T', await family(q, G.t), both);
    await mergeInto(q, G.t, G.x);
    const chain = [G.s, G.t, G.x].sort();
    check(
      'a chain S to T to X: all three from each end and the middle',
      [await family(q, G.s), await family(q, G.t), await family(q, G.x)],
      [chain, chain, chain],
    );
    await q`UPDATE global_persons SET merged_into_id = NULL WHERE id = ${G.s}`;
    check(
      'a revert splits it: S alone, T and X together',
      [await family(q, G.s), await family(q, G.t)],
      [[G.s], [G.t, G.x].sort()],
    );
  });
}

// ── fightbook_flag_shown ────────────────────────────────────────────────────
export async function flagShown(tx) {
  await shownBasics(tx);
  await shownUnlinked(tx);
  await shownMerged(tx);
  await shownAfterRevert(tx);
}

/** Marc is a club admin; Julie flags him. */
async function shownBasics(tx) {
  await scenario(tx, async (q) => {
    await q`INSERT INTO organization_members (organization_id, user_id, role)
      VALUES (${ORG}, ${U.marc}, 'admin'), (${ORG}, ${A.adminOne}, 'admin')`;
    const flagId = await flag(q, await eventSpar(q, F.marc, F.julie), F.julie);
    check('the flagged account reads nothing (club)', await shown(q, flagId, U.marc, true), false);
    check(
      'the flagged account reads nothing (platform)',
      await shown(q, flagId, U.marc, false),
      false,
    );
    check('an unrelated club admin reads it', await shown(q, flagId, A.adminOne, true), true);
    check('no caller reads nothing', await shown(q, flagId, null, false), false);
    check('an unknown flag is not shown', await shown(q, id(998), A.adminOne, true), false);
    await claim(q, F.marc, null);
    check(
      'Marc unlinked AFTER the flag: still hidden from him (the snapshot)',
      [await shown(q, flagId, U.marc, true), await shown(q, flagId, U.marc, false)],
      [false, false],
    );
    check(
      'and the club loses it while no account holds him, the super admin keeps it',
      [await shown(q, flagId, A.adminOne, true), await shown(q, flagId, A.root, false)],
      [false, true],
    );
  });
}

/** Marc unlinks BEFORE the flag: the snapshot holds no account. */
async function shownUnlinked(tx) {
  await scenario(tx, async (q) => {
    await claim(q, F.marc, null);
    const flagId = await flag(q, await eventSpar(q, F.marc, F.julie), F.julie);
    const [{ holder }] =
      await q`SELECT subject_user_id AS holder FROM spar_flag_admin WHERE flag_id = ${flagId}`;
    check('written while unheld: the snapshot holds no account', holder, null);
    check(
      'unheld: no club reader, not even Marc or another admin',
      [await shown(q, flagId, A.adminOne, true), await shown(q, flagId, U.marc, true)],
      [false, false],
    );
    check('unheld: the super admin without a club', await shown(q, flagId, A.root, false), true);
    await claim(q, F.marc, U.marc);
    check(
      'linked again: the other admin reads it, Marc still does not',
      [await shown(q, flagId, A.adminOne, true), await shown(q, flagId, U.marc, true)],
      [true, false],
    );
  });
}

/** S merged into T. */
async function shownMerged(tx) {
  await scenario(tx, async (q) => {
    await claim(q, G.s, A.a1);
    await claim(q, G.t, A.a2);
    const flagId = await flag(q, await eventSpar(q, G.s, F.julie), F.julie);
    await mergeInto(q, G.s, G.t);
    check(
      'S and T merged, held by two accounts: hidden from both, shown to a bystander',
      [
        await shown(q, flagId, A.a1, true),
        await shown(q, flagId, A.a2, true),
        await shown(q, flagId, A.adminOne, true),
      ],
      [false, false, true],
    );
  });
  await scenario(tx, async (q) => {
    await claim(q, G.s, A.a1);
    const flagId = await flag(q, await eventSpar(q, G.s, F.julie), F.julie);
    await mergeInto(q, G.s, G.t);
    await claim(q, G.s, null);
    await claim(q, G.t, A.a1);
    check(
      'the claim moved to the survivor: hidden from it on a flag about S',
      await shown(q, flagId, A.a1, true),
      false,
    );
  });
  await scenario(tx, async (q) => {
    const flagId = await flag(q, await eventSpar(q, G.s, F.julie), F.julie);
    await mergeInto(q, G.s, G.t);
    await claim(q, G.t, A.a2);
    check(
      'written unheld, then S merged into a held T: hidden from T’s account by the family alone',
      [await shown(q, flagId, A.a2, true), await shown(q, flagId, A.a2, false)],
      [false, false],
    );
  });
}

/** A flag about T written during the merge, read after the revert with the claim moved back. */
async function shownAfterRevert(tx) {
  await scenario(tx, async (q) => {
    await claim(q, G.s, A.a1);
    await mergeInto(q, G.s, G.t);
    await claim(q, G.s, null);
    await claim(q, G.t, A.a1);
    const flagId = await flag(q, await eventSpar(q, G.t, F.julie), F.julie);
    await q`UPDATE global_persons SET merged_into_id = NULL WHERE id = ${G.s}`;
    await claim(q, G.t, null);
    await claim(q, G.s, A.a1);
    check(
      'after the revert: hidden from the account that held T when it was written',
      await shown(q, flagId, A.a1, true),
      false,
    );
    check(
      'T unheld: hidden from the club, shown to a super admin',
      [await shown(q, flagId, A.adminOne, true), await shown(q, flagId, A.root, false)],
      [false, true],
    );
  });
}
