import { Logger, NotFoundException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StaffService } from './staff.service';
import { StaffController } from './staff.controller';
import { mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';

/**
 * The public piste display — the endpoint a venue TV points at.
 *
 * No session, no organiser, no staff cookie: it takes an event slug and a piste
 * NAME off the URL and answers with whatever is on that piste. Piste names are
 * unique per event, not globally, so `Piste 1` exists at every event in the
 * database. The event scope in front of the name match is the only thing
 * keeping one venue's screen off another venue's bout.
 *
 * `lices` is seeded as ROWS here, so both halves of the lookup are OUTCOMES:
 * the event scope is proved by a same-named piste at another event that would
 * otherwise sort first, and the name match by which board comes back. The
 * double models `ilike` as Postgres does — `%` any run, `_` exactly one,
 * anchored at both ends — which is what made the old single-query lookup
 * (`.ilike('name', liceName)`) reproducible as a unit test at all: a `Piste_1`
 * URL answered with `Piste 1`'s scoreboard, and a `%` URL matched every piste
 * and fell out of `maybeSingle` as a raw PostgREST message in a 400.
 *
 * Two pistes of one event may share a name — nothing in the schema stops it
 * (`lices` has no unique index on the pair, and only `lices.service` trims a
 * typed name; the venue catalogue copies its own through untouched). So the
 * name match is a resolution with a deciding order, not a lookup.
 *
 * The controller is driven as well as the service, because the name reaches the
 * lookup through it: Fastify's router has already percent-decoded the segment,
 * so a second decode there is the same defect one layer up.
 */

const EVENT = 'event-1';
const OTHER_EVENT = 'event-2';
const LICE = 'lice-1';
/** Ties `LICE` on `sort_order` and sorts before it on `id`, so dropping the
 * event scope hands this row the answer. */
const OTHER_LICE = 'lice-0';

const eventRow = (id: string) => ({
  id,
  organization_id: 'org-1',
  slug: `slug-${id}`,
  name: `Event ${id}`,
  status: 'running',
  start_date: '2026-08-08',
  end_date: '2099-12-31',
});

/**
 * A piste row carrying its own event embed, because `getCurrentForLiceId`
 * reads `events(...)` off it and a seeded table returns rows, not joins.
 */
const liceRow = (id: string, name: string, eventId: string, sortOrder: number) => ({
  id,
  name,
  event_id: eventId,
  sort_order: sortOrder,
  events: { id: eventId, slug: `slug-${eventId}`, name: `Event ${eventId}`, status: 'running' },
});

const DEFAULT_LICES = [
  liceRow(OTHER_LICE, 'Piste 1', OTHER_EVENT, 0),
  liceRow(LICE, 'Piste 1', EVENT, 0),
  liceRow('lice-2', 'Piste 2', EVENT, 1),
  // Folds to `Piste 1` under any rule wider than trim, and sorts after it, so a
  // fold that strips inner whitespace would answer for this piste with LICE.
  liceRow('lice-3', 'Piste1', EVENT, 2),
  // A name that IS a percent-escape, and one holding a bare `%`. Both are legal
  // TEXT, and both are what a second decode of the URL segment destroys.
  liceRow('lice-esc', 'Piste%201', EVENT, 3),
  liceRow('lice-pct', '100% Cotton', EVENT, 4),
];

/** A bout on a piste, with the Tournament and Event its visibility is read from. */
const bout = (
  id: string,
  status: string,
  scheduledAt: string,
  tournamentStatus = 'running',
  event: { id: string; status: string } = { id: EVENT, status: 'running' },
) => ({
  id,
  lice_id: LICE,
  status,
  scheduled_at: scheduledAt,
  phases: {
    tournaments: {
      status: tournamentStatus,
      events: { ...event, organization_id: 'org-1' },
    },
  },
  // The flat key a dotted filter reads on a seeded row (`onlyPublicTournaments`).
  'phases.tournaments.status': tournamentStatus,
});

const RUNNING_ON_LICE = [bout('match-here', 'running', '2026-08-08T09:00:00Z')];

/** No login, no staff cookie: the hall projector. */
const ANON = { userId: 'anonymous', staff: null };
const ANON_REQ = { headers: {}, cookies: {}, identity: { kind: 'anonymous' } } as never;

function build(
  matches: Array<Record<string, unknown>> = [],
  lices: Array<Record<string, unknown>> = DEFAULT_LICES,
  events: Array<Record<string, unknown>> = [eventRow(OTHER_EVENT), eventRow(EVENT)],
) {
  const supabase = mockSupabase({
    events: { rows: events },
    lices: { rows: lices },
    matches: { rows: matches },
    organization_members: {
      rows: [{ organization_id: 'org-1', user_id: 'u-member', role: 'read_only' }],
    },
    event_staff_accounts: { rows: [{ id: 'staff-1', event_id: EVENT, status: 'active' }] },
  });
  const orgs = new OrganizationsService(supabase as never);
  const service = new StaffService(supabase as never, orgs, {} as never, {} as never);
  const controller = new StaffController(service, supabase as never, orgs);
  return { service, controller, supabase };
}

type LiceCurrent = { liceId: string; current: { id: string } | null };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('StaffService.getPublicLiceCurrent', () => {
  it('answers with the board of the piste whose name is in the URL, at that URL event', async () => {
    const { service, supabase } = build(RUNNING_ON_LICE);

    const result = (await service.getPublicLiceCurrent(
      `slug-${EVENT}`,
      'Piste 1',
      ANON,
    )) as LiceCurrent;

    expect(result.liceId).toBe(LICE);
    expect(result.current?.id).toBe('match-here');
    // The name is compared here, not by the database, so the projection has to
    // carry it: with the column dropped the fold reads undefined and the route
    // throws a TypeError — a 500 on a public screen, not a quiet miss.
    expect(selectsFor(supabase.from, 'lices')).toContain('id,name');
  });

  it('does not hand a `Piste_1` URL the board of `Piste 1`', async () => {
    const { service } = build(RUNNING_ON_LICE);

    await expect(
      service.getPublicLiceCurrent(`slug-${EVENT}`, 'Piste_1', ANON),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('answers a `%` URL with our own not-found, not the database’s message', async () => {
    const { service } = build(RUNNING_ON_LICE);

    const error = await service
      .getPublicLiceCurrent(`slug-${EVENT}`, '%', ANON)
      .then(() => null)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as Error).message).toBe('Lice not found');
  });

  it('finds the piste when the URL name differs only in case and padding', async () => {
    const { service } = build(RUNNING_ON_LICE);

    const result = (await service.getPublicLiceCurrent(
      `slug-${EVENT}`,
      '  piste 1  ',
      ANON,
    )) as LiceCurrent;

    expect(result.liceId).toBe(LICE);
    expect(result.current?.id).toBe('match-here');
  });

  it('tells `Piste1` from `Piste 1` — the fold trims, it does not strip', async () => {
    const { service } = build(RUNNING_ON_LICE);

    const result = (await service.getPublicLiceCurrent(
      `slug-${EVENT}`,
      'Piste1',
      ANON,
    )) as LiceCurrent;

    expect(result.liceId).toBe('lice-3');
  });

  it('takes the lowest sort_order, then the lowest id, when two pistes share a name', async () => {
    // The two keys disagree and neither agrees with the seed order, so the
    // winner is the one only `sort_order` THEN `id` picks: `lice-a` has the
    // lowest id, `lice-z` comes first as seeded, and both are wrong.
    const { service } = build(
      [],
      [
        liceRow('lice-z', ' Piste 1 ', EVENT, 1),
        liceRow('lice-m', 'Piste 1', EVENT, 1),
        liceRow('lice-a', 'PISTE 1', EVENT, 5),
      ],
    );

    const result = (await service.getPublicLiceCurrent(
      `slug-${EVENT}`,
      'Piste 1',
      ANON,
    )) as LiceCurrent;

    expect(result.liceId).toBe('lice-m');
  });

  it('says so when two pistes answer to one name, because the screen cannot', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service } = build(
      [],
      [liceRow('lice-m', 'Piste 1', EVENT, 1), liceRow('lice-z', ' PISTE 1', EVENT, 1)],
    );

    await service.getPublicLiceCurrent(`slug-${EVENT}`, 'Piste 1', ANON);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('2 pistes named "piste 1"'));
  });

  it('stays quiet when one piste answers', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service } = build(RUNNING_ON_LICE);

    await service.getPublicLiceCurrent(`slug-${EVENT}`, 'Piste 1', ANON);

    expect(warn).not.toHaveBeenCalled();
  });

  it('refuses an event slug that does not exist rather than falling back to one', async () => {
    const { service } = build();

    await expect(
      service.getPublicLiceCurrent('slug-nowhere', 'Piste 1', ANON),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

/**
 * Fastify's router percent-decodes a path parameter before the handler sees it,
 * so the controller receives the piste's real name. Decoding again turned a
 * name that merely LOOKS like an escape into a different name.
 */
describe('StaffController.publicLiceCurrent takes the name as the router decoded it', () => {
  it('does not turn a piste named `Piste%201` into `Piste 1`', async () => {
    const { controller } = build(RUNNING_ON_LICE);

    const result = (await controller.publicLiceCurrent(
      `slug-${EVENT}`,
      'Piste%201',
      ANON_REQ,
    )) as LiceCurrent;

    expect(result.liceId).toBe('lice-esc');
  });

  it('answers for a piste whose name holds a bare `%` instead of failing', async () => {
    const { controller } = build(RUNNING_ON_LICE);

    const result = (await controller.publicLiceCurrent(
      `slug-${EVENT}`,
      '100% Cotton',
      ANON_REQ,
    )) as LiceCurrent;

    expect(result.liceId).toBe('lice-pct');
  });

  it('still finds an ordinary name', async () => {
    const { controller } = build(RUNNING_ON_LICE);

    const result = (await controller.publicLiceCurrent(
      `slug-${EVENT}`,
      'Piste 1',
      ANON_REQ,
    )) as LiceCurrent;

    expect(result.liceId).toBe(LICE);
    expect(result.current?.id).toBe('match-here');
  });
});

/**
 * The hall projector has no login and no staff cookie. A draft Event's piste,
 * and a bout of a Tournament that is not published, stay dark for it; a laptop
 * signed in as a club member, or the Event's own staff, sees them (rulings
 * 81-83, 89).
 */
describe('the public piste board hides what is not public (rulings 81-83, 89)', () => {
  const MEMBER = { userId: 'u-member', staff: null };
  const STAFF = { userId: 'anonymous', staff: { staffId: 'staff-1', eventId: EVENT } };
  const draftEvent = () =>
    build(
      [
        bout('match-here', 'running', '2026-08-08T09:00:00Z', 'running', {
          id: EVENT,
          status: 'draft',
        }),
      ],
      DEFAULT_LICES,
      [eventRow(OTHER_EVENT), { ...eventRow(EVENT), status: 'draft' }],
    );
  const refusal = (call: Promise<unknown>) =>
    call.then(
      () => null,
      (error: unknown) => (error as NotFoundException).getResponse(),
    );

  it("answers a draft Event's piste to a projector exactly as an unknown slug", async () => {
    const { service, supabase } = draftEvent();
    const unknown = await refusal(service.getPublicLiceCurrent('slug-nowhere', 'Piste 1', ANON));
    expect(await refusal(service.getPublicLiceCurrent(`slug-${EVENT}`, 'Piste 1', ANON))).toEqual(
      unknown,
    );
    expect(selectsFor(supabase.from, 'lices')).toEqual([]);
  });

  it("shows a draft Event's piste to a club member and to the Event's staff", async () => {
    for (const reader of [MEMBER, STAFF]) {
      const { service } = draftEvent();
      const result = (await service.getPublicLiceCurrent(
        `slug-${EVENT}`,
        'Piste 1',
        reader,
      )) as LiceCurrent;
      expect(result.current?.id).toBe('match-here');
    }
  });

  it('leaves a bout of an unpublished Tournament off the board for a projector', async () => {
    const matches = [
      bout('match-draft-t', 'running', '2026-08-08T09:00:00Z', 'draft'),
      bout('match-next', 'scheduled', '2026-08-08T09:30:00Z', 'published'),
      bout('match-done-t', 'scheduled', '2026-08-08T10:00:00Z', 'completed'),
    ];
    const projector = (await build(matches).service.getPublicLiceCurrent(
      `slug-${EVENT}`,
      'Piste 1',
      ANON,
    )) as LiceCurrent & { queue: Array<{ id: string }> };
    expect(projector.current?.id).toBe('match-next');
    expect(projector.queue.map((row) => row.id)).toEqual(['match-done-t']);

    const member = (await build(matches).service.getPublicLiceCurrent(
      `slug-${EVENT}`,
      'Piste 1',
      MEMBER,
    )) as LiceCurrent;
    expect(member.current?.id).toBe('match-draft-t');
  });

  it('decides what is public before it keeps the first eight bouts', async () => {
    // Organisers schedule a Tournament before they publish it: eight of its bouts
    // sort ahead of the one public bout, and the board reads eight at a time.
    const hidden = Array.from({ length: 8 }, (_, i) =>
      bout(`match-hidden-${i}`, 'scheduled', `2026-08-08T0${i}:00:00Z`, 'draft'),
    );
    const matches = [...hidden, bout('match-public', 'scheduled', '2026-08-08T09:00:00Z')];
    const projector = (await build(matches).service.getPublicLiceCurrent(
      `slug-${EVENT}`,
      'Piste 1',
      ANON,
    )) as LiceCurrent;
    expect(projector.current?.id).toBe('match-public');
  });

  it('reads each deciding column', async () => {
    const { service, supabase } = build([
      bout('match-draft-t', 'running', '2026-08-08T09:00:00Z', 'draft'),
    ]);
    await service.getPublicLiceCurrent(`slug-${EVENT}`, 'Piste 1', MEMBER);
    // The double hands back the whole row whatever is selected, and PostgREST
    // filters bouts through an embed only when every embed on the path is inner.
    const [select] = selectsFor(supabase.from, 'matches');
    expect(select).toContain('phases!inner(');
    expect(select).toMatch(/tournaments!inner\([^)]*\bstatus\b/);
    expect(selectsFor(supabase.from, 'organization_members')).toEqual(['role']);
    const { service: staffView, supabase: staffDb } = draftEvent();
    await staffView.getPublicLiceCurrent(`slug-${EVENT}`, 'Piste 1', STAFF);
    expect(selectsFor(staffDb.from, 'event_staff_accounts')).toEqual(['status']);
  });
});
