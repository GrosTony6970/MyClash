/**
 * The scenarios of `scripts/db-fightbook-probe.mjs` for slice 4 (migration 0269), part two: the
 * list (`fightbook_flags_page`), the handled mark, the alert's recipients, account erasure, the
 * foreign-key actions and the service-role grants. The seed, the write and the "shown" rule are in
 * fightbook-probe-flags.mjs.
 */
import { F, U } from './fightbook-probe-scenarios.mjs';
import {
  A,
  EVENT_TO_DELETE,
  G,
  NOW,
  ORG,
  ORG2,
  claim,
  eventSpar,
  flag,
  mergeInto,
  rawFlag,
} from './fightbook-probe-flags.mjs';
import { check, scenario } from './merge-probe-fixture.mjs';

const minute = (n) => new Date(Date.parse(NOW) + n * 60_000).toISOString();

// ── fightbook_flags_page ────────────────────────────────────────────────────
const page = (q, caller, org, offset, limit) =>
  q`SELECT * FROM public.fightbook_flags_page(${caller}, ${org}::uuid, ${offset}, ${limit})`;
const ids = (rows) => rows.map((row) => row.id);

/** Eleven flags in the club, two about the caller's own profile, three in another club. */
export async function flagsPage(tx) {
  await scenario(tx, async (q) => {
    await claim(q, F.paul, null);
    await claim(q, F.paul, A.adminOne);
    const mine = new Set([2, 7]);
    const inClub = [];
    for (let i = 0; i < 11; i += 1)
      inClub.push(await rawFlag(q, { subject: mine.has(i) ? F.paul : F.julie, at: minute(i) }));
    for (let i = 20; i < 23; i += 1)
      await rawFlag(q, { subject: F.julie, org: ORG2, at: minute(i) });
    // Newest of all, about a profile no account holds: the club list leaves it out (ruling 696).
    const unheld = await rawFlag(q, { subject: G.x, holder: null, at: minute(30) });
    const visible = inClub.filter((_, i) => !mine.has(i)).reverse();

    const first = await page(q, A.adminOne, ORG, 0, 5);
    const second = await page(q, A.adminOne, ORG, 5, 5);
    check(
      'the club page is exact: 9 shown of 11, offset 0 limit 5 gives 5, offset 5 gives 4',
      [first.length, second.length],
      [5, 4],
    );
    check(
      'newest first, the caller’s own flags never in a page, only its club',
      [...ids(first), ...ids(second)],
      visible,
    );
    check(
      'a page never carries the flagged account',
      Object.keys(first[0]).includes('subject_user_id'),
      false,
    );
    const platform = await page(q, A.adminOne, null, 0, 100);
    check(
      'the platform scope lists every club, still without the caller’s own',
      [platform.length, platform.some((row) => inClub[2] === row.id)],
      [13, false],
    );
    const everything = await page(q, A.root, null, 0, 100);
    check('a super admin reads all fifteen, the unheld one first', ids(everything).slice(0, 1), [
      unheld,
    ]);
    check('and counts them', everything.length, 15);
    check(
      'the club scope leaves a flag about an unheld profile out, on every page',
      ids(await page(q, A.adminOne, ORG, 0, 100)).includes(unheld),
      false,
    );
  });
}

// ── fightbook_flag_mark ─────────────────────────────────────────────────────
const mark = (q, caller, org, flagId, handled, now) =>
  q`SELECT public.fightbook_flag_mark(${caller}, ${org}::uuid, ${flagId}, ${handled},
      ${now}::timestamptz) AS r`.then((rows) => rows[0].r);

const handledAt = (q, flagId) =>
  q`SELECT handled_at FROM spar_flag_admin WHERE flag_id = ${flagId}`.then((rows) =>
    rows[0].handled_at ? rows[0].handled_at.toISOString() : null,
  );

export async function flagMark(tx) {
  await scenario(tx, async (q) => {
    await claim(q, F.paul, null);
    await claim(q, F.paul, A.adminOne);
    const flagId = await rawFlag(q, { subject: F.julie });
    const t1 = minute(5);
    const t2 = minute(9);
    check(
      'handled sets the mark',
      [await mark(q, A.adminOne, ORG, flagId, true, t1), await handledAt(q, flagId)],
      [true, t1],
    );
    check(
      'a second set answers true and keeps the first time',
      [await mark(q, A.adminOne, ORG, flagId, true, t2), await handledAt(q, flagId)],
      [true, t1],
    );
    check(
      'clear empties it',
      [await mark(q, A.adminOne, ORG, flagId, false, t2), await handledAt(q, flagId)],
      [true, null],
    );
    check(
      'another club: false, nothing written',
      [await mark(q, A.adminOne, ORG2, flagId, true, t1), await handledAt(q, flagId)],
      [false, null],
    );
    check(
      'the platform scope marks any shown flag',
      [await mark(q, A.root, null, flagId, true, t2), await handledAt(q, flagId)],
      [true, t2],
    );
    const own = await rawFlag(q, { subject: F.paul });
    check(
      'a flag hidden from the caller: false, nothing written',
      [await mark(q, A.adminOne, ORG, own, true, t1), await handledAt(q, own)],
      [false, null],
    );
    const unheld = await rawFlag(q, { subject: G.x, holder: null });
    check(
      'a flag about an unheld profile, club scope: false, nothing written',
      [await mark(q, A.adminOne, ORG, unheld, true, t1), await handledAt(q, unheld)],
      [false, null],
    );
  });
}

// ── fightbook_flag_recipients ───────────────────────────────────────────────
const recipients = (q, flagId) =>
  q`SELECT user_id, audience, org_slug FROM public.fightbook_flag_recipients(${flagId},
      ${['owner', 'admin']}::text[]) ORDER BY user_id`;

export async function flagRecipients(tx) {
  await scenario(tx, async (q) => {
    await q`INSERT INTO organization_members (organization_id, user_id, role) VALUES
      (${ORG}, ${U.marc}, 'admin'), (${ORG}, ${A.adminOne}, 'admin'), (${ORG}, ${A.owner}, 'owner'),
      (${ORG}, ${A.referee}, 'referee'), (${ORG}, ${U.julie}, 'admin')`;
    const flagId = await rawFlag(q, { subject: F.marc, reporter: F.julie });
    check(
      'an owner and an admin, not the referee, not the flagged admin, not the reporter, no super admin',
      await recipients(q, flagId),
      [
        { user_id: A.adminOne, audience: 'club', org_slug: 'fightbook-probe' },
        { user_id: A.owner, audience: 'club', org_slug: 'fightbook-probe' },
      ],
    );
    await q`DELETE FROM organization_members WHERE user_id IN (${A.adminOne}, ${A.owner}, ${U.julie})`;
    check(
      'the flagged fighter the only admin: the super admins, never a platform admin',
      await recipients(q, flagId),
      [{ user_id: A.root, audience: 'platform', org_slug: null }],
    );
    const free = await rawFlag(q, { subject: F.marc, reporter: F.julie, org: null });
    check('no club: the super admins', await recipients(q, free), [
      { user_id: A.root, audience: 'platform', org_slug: null },
    ]);
  });
  await recipientScopes(tx);
}

/** Who is left out: the flagged fighter and the reporter, also as a super admin, and the reporter's family. */
async function recipientScopes(tx) {
  const slug = 'fightbook-probe';
  await scenario(tx, async (q) => {
    await claim(q, G.x, A.root);
    const free = await rawFlag(q, { subject: G.x, reporter: F.julie, org: null });
    check('a super admin who is the flagged fighter is not told', await recipients(q, free), []);
  });
  await scenario(tx, async (q) => {
    await claim(q, G.t, A.root);
    const free = await rawFlag(q, { subject: F.marc, reporter: G.t, org: null });
    check('a super admin who is the reporter is not told', await recipients(q, free), []);
  });
  await scenario(tx, async (q) => {
    await q`INSERT INTO organization_members (organization_id, user_id, role)
      VALUES (${ORG}, ${A.adminOne}, 'admin'), (${ORG}, ${A.owner}, 'owner')`;
    await mergeInto(q, G.s, F.julie);
    await claim(q, G.s, A.adminOne);
    const flagId = await rawFlag(q, { subject: F.marc, reporter: F.julie });
    check(
      'a club admin who holds a profile merged into the reporter’s is not told',
      await recipients(q, flagId),
      [{ user_id: A.owner, audience: 'club', org_slug: slug }],
    );
  });
  await scenario(tx, async (q) => {
    await q`INSERT INTO organization_members (organization_id, user_id, role)
      VALUES (${ORG}, ${A.adminOne}, 'admin')`;
    const flagId = await rawFlag(q, { subject: G.x, holder: null });
    check(
      'a club flag about an unheld profile goes to the super admins, not the club admins',
      await recipients(q, flagId),
      [{ user_id: A.root, audience: 'platform', org_slug: null }],
    );
  });
}

// ── fightbook_flags_erase ───────────────────────────────────────────────────
const erase = (q, uid, profiles) =>
  q`SELECT public.fightbook_flags_erase(${uid}, ${profiles}::uuid[]) AS r`.then(
    (rows) => rows[0].r,
  );

/** What is left of the given flags, with each one's reporter, by flag id. */
const survivors = (q, flagIds) =>
  q`SELECT id, reporter_global_person_id AS reporter FROM spar_flags WHERE id = ANY(${flagIds}::uuid[])`.then(
    (rows) => rows.map((row) => [row.id, row.reporter]).sort(([a], [b]) => (a < b ? -1 : 1)),
  );
const byId = (pairs) => pairs.sort(([a], [b]) => (a < b ? -1 : 1));

export async function flagsErase(tx) {
  await scenario(tx, async (q) => {
    await mergeInto(q, G.s, F.marc);
    const about = await rawFlag(q, { subject: F.marc });
    const aboutMerged = await rawFlag(q, { subject: G.s });
    const unlinked = await rawFlag(q, { subject: G.x, holder: U.marc });
    const other = await rawFlag(q, { subject: F.paul });
    const written = await rawFlag(q, { subject: F.julie, reporter: F.marc });
    check(
      'erasing Marc: three flags deleted, one reporter cleared',
      await erase(q, U.marc, [F.marc]),
      {
        cleared: 1,
        deleted: 3,
      },
    );
    check(
      'the flags about his family (merged S included) and the unlinked one go; another fighter’s stays; the one he wrote stays with no reporter',
      await survivors(q, [about, aboutMerged, unlinked, other, written]),
      byId([
        [other, F.julie],
        [written, null],
      ]),
    );
  });
  await erasedMergeOfTwoClaimed(tx);
  await erasedAfterClaimMoved(tx);
  await scenario(tx, async (q) => {
    const stale = await rawFlag(q, { subject: F.paul, holder: U.marc });
    check(
      'erasing Marc, a flag he held at write time but Paul holds now',
      await erase(q, U.marc, [F.marc]),
      {
        cleared: 0,
        deleted: 0,
      },
    );
    check('stays', (await survivors(q, [stale])).length, 1);
  });
}

/** S (account one) merged into T (account two): erasing one reaches no further than S. */
async function erasedMergeOfTwoClaimed(tx) {
  await scenario(tx, async (q) => {
    await claim(q, G.s, A.a1);
    await claim(q, G.t, A.a2);
    await mergeInto(q, G.s, G.t);
    const aboutS = await rawFlag(q, { subject: G.s });
    const aboutT = await rawFlag(q, { subject: G.t });
    const byS = await rawFlag(q, { subject: F.julie, reporter: G.s });
    const byT = await rawFlag(q, { subject: F.julie, reporter: G.t });
    check('erasing account one', await erase(q, A.a1, [G.s]), { cleared: 1, deleted: 1 });
    check(
      'the flag about S goes; the one about T stays, and so does the link of T’s reporter',
      await survivors(q, [aboutS, aboutT, byS, byT]),
      byId([
        [aboutT, F.julie],
        [byS, null],
        [byT, G.t],
      ]),
    );
  });
}

/** S flagged, then S merged into an unheld T and the claim moved: S is held by no account. */
async function erasedAfterClaimMoved(tx) {
  await scenario(tx, async (q) => {
    await claim(q, G.s, A.a1);
    const byS = await rawFlag(q, { subject: F.julie, reporter: G.s });
    await mergeInto(q, G.s, G.t);
    await claim(q, G.s, null);
    await claim(q, G.t, A.a1);
    check(
      'erasing the account the claim moved to: the reporter of the flag S wrote is cleared',
      [await erase(q, A.a1, [G.t]), await survivors(q, [byS])],
      [{ cleared: 1, deleted: 0 }, [[byS, null]]],
    );
  });
}

// ── The foreign keys ────────────────────────────────────────────────────────
export async function flagForeignKeys(tx) {
  await scenario(tx, async (q) => {
    const request = await eventSpar(q, F.marc, F.julie, { event_id: EVENT_TO_DELETE });
    const flagId = await flag(q, request, F.julie);
    const read = () =>
      q`SELECT spar_request_id AS request, event_id AS event, organization_id AS org
          FROM spar_flags WHERE id = ${flagId}`.then((rows) => rows[0]);
    await q`DELETE FROM events WHERE id = ${EVENT_TO_DELETE}`;
    check('an Event deleted: the flag keeps its club', await read(), {
      request,
      event: null,
      org: ORG,
    });
    await q`DELETE FROM spar_requests WHERE id = ${request}`;
    check('the request deleted: the flag stays', await read(), {
      request: null,
      event: null,
      org: ORG,
    });
    await q`DELETE FROM spar_flags WHERE id = ${flagId}`;
    const [{ n }] =
      await q`SELECT count(*)::int AS n FROM spar_flag_admin WHERE flag_id = ${flagId}`;
    check('a flag deleted takes its admin row', n, 0);
  });
}

export const FLAG_FUNCTIONS = [
  'public.fightbook_profile_family(uuid[])',
  'public.fightbook_flag_shown(uuid, uuid, boolean)',
  'public.fightbook_flag(uuid, uuid, text, text, timestamp with time zone)',
  'public.fightbook_flags_page(uuid, uuid, integer, integer)',
  'public.fightbook_flag_mark(uuid, uuid, uuid, boolean, timestamp with time zone)',
  'public.fightbook_flag_recipients(uuid, text[])',
  'public.fightbook_flags_erase(uuid, uuid[])',
];
