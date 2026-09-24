import 'reflect-metadata';
import type { NotFoundException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { queriedTables, selectsFor } from '../../common/testing/supabase-chain';
import { StaffController } from './staff.controller';
import {
  ANON,
  DEFAULT_LICES,
  EVENT,
  OTHER_EVENT,
  PUBLIC_TOURNAMENTS,
  RUNNING_ON_LICE,
  bout,
  build,
  eventRow,
  tournamentRow,
  type LiceCurrent,
} from './staff.service.public-lice.fixtures';

const MEMBER = { userId: 'u-member', staff: null };
const STAFF = { userId: 'anonymous', staff: { staffId: 'staff-1', eventId: EVENT } };

/** A draft Event, its piste and (unless told otherwise) one running bout on it. */
const draftEvent = (
  matches: Array<Record<string, unknown>> = [
    bout('match-here', 'running', '2026-08-08T09:00:00Z', 'running', {
      id: EVENT,
      status: 'draft',
    }),
  ],
) =>
  build(matches, DEFAULT_LICES, [eventRow(OTHER_EVENT), { ...eventRow(EVENT), status: 'draft' }]);

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * The hall projector has no login and no staff cookie. A draft Event's piste,
 * and a bout of a Tournament that is not published, stay dark for it; a laptop
 * signed in as a club member, or the Event's own staff, sees them (rulings
 * 81-83, 89).
 */
describe('the public piste board hides what is not public (rulings 81-83, 89)', () => {
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
    // The Event's Tournaments decide the board's poll mark (ruling 92).
    expect(selectsFor(supabase.from, 'tournaments')).toEqual(['status']);
    const { service: staffView, supabase: staffDb } = draftEvent();
    await staffView.getPublicLiceCurrent(`slug-${EVENT}`, 'Piste 1', STAFF);
    expect(selectsFor(staffDb.from, 'event_staff_accounts')).toEqual(['status']);
  });
});

/**
 * web-public's live channel is anonymous, and RLS keeps a hidden bout's rows off
 * it. A piste screen signed in as a club member on a draft Event heard nothing
 * from its channel, so it never rolled to the next bout. The board now says when
 * its Event hides anything from the public, and the screen polls it (ruling 92).
 *
 * The Event decides, not the bouts on the board: a draft Tournament's first bout
 * can be put on an empty piste at any time, and nothing announces it.
 */
describe('the public piste board marks what its screen must poll (ruling 92)', () => {
  const hiddenFromPublic = async (
    reader: typeof ANON | typeof MEMBER | typeof STAFF,
    fixture: ReturnType<typeof build>,
  ) =>
    (
      (await fixture.service.getPublicLiceCurrent(`slug-${EVENT}`, 'Piste 1', reader)) as {
        hiddenFromPublic: unknown;
      }
    ).hiddenFromPublic;
  const WITH_DRAFT_T = [...PUBLIC_TOURNAMENTS, tournamentRow('t-draft', EVENT, 'draft')];
  const MIXED = [
    bout('match-draft-t', 'running', '2026-08-08T09:00:00Z', 'draft'),
    bout('match-next', 'scheduled', '2026-08-08T09:30:00Z', 'published'),
  ];
  const withTournaments = (tournaments: Array<Record<string, unknown>>, matches = MIXED) =>
    build(matches, DEFAULT_LICES, [eventRow(OTHER_EVENT), eventRow(EVENT)], tournaments);

  it("marks a draft Event's board for a club member and for the Event's staff", async () => {
    expect(await hiddenFromPublic(MEMBER, draftEvent())).toBe(true);
    expect(await hiddenFromPublic(STAFF, draftEvent())).toBe(true);
    expect(await hiddenFromPublic(MEMBER, draftEvent([]))).toBe(true);
  });

  it('marks a board whose Event has a Tournament that is not public', async () => {
    expect(await hiddenFromPublic(MEMBER, withTournaments(WITH_DRAFT_T))).toBe(true);
    const archived = [...PUBLIC_TOURNAMENTS, tournamentRow('t-old', EVENT, 'archived')];
    expect(await hiddenFromPublic(STAFF, withTournaments(archived))).toBe(true);
  });

  // The morning's public bouts are done, the board is empty, and the organiser
  // then puts the draft Tournament's first bout on this piste.
  it('marks an EMPTY board whose Event has a draft Tournament', async () => {
    expect(await hiddenFromPublic(MEMBER, withTournaments(WITH_DRAFT_T, []))).toBe(true);
  });

  // Every piste screen of a venue shares one address: ten polling at 12/min spent
  // the global 120/min limit, and a 429 kept the screen retrying.
  it('reads the board on the live-read limit, not the global one', () => {
    expect(
      Reflect.getMetadata('THROTTLER:LIMITglobal', StaffController.prototype.publicLiceCurrent),
    ).toBe(600);
  });

  it("does not mark a projector's board, and reads no Tournament for it", async () => {
    const fixture = withTournaments(WITH_DRAFT_T);
    expect(await hiddenFromPublic(ANON, fixture)).toBe(false);
    expect(queriedTables(fixture.supabase.from)).not.toContain('tournaments');
  });

  it('does not mark a board whose Event shows everything, for anyone', async () => {
    // A draft Tournament of ANOTHER Event says nothing about this one.
    const elsewhere = [...PUBLIC_TOURNAMENTS, tournamentRow('t-other', OTHER_EVENT, 'draft')];
    for (const reader of [ANON, MEMBER, STAFF]) {
      const board = withTournaments(elsewhere, RUNNING_ON_LICE);
      expect(await hiddenFromPublic(reader, board), reader.userId).toBe(false);
    }
    expect(await hiddenFromPublic(MEMBER, withTournaments(elsewhere, []))).toBe(false);
  });
});
