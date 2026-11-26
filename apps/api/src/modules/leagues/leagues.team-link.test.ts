/**
 * A League takes individual Tournaments only: League points belong to persons (rulings 729, 981).
 *
 * The story: Lyon's Spring Cup holds "Longsword Open" (individual), "Sabre Open" (individual) and
 * "Team Longsword" (a team Tournament). The French League links the Event. Each League door refuses
 * the team Tournament with the 409 `team_tournament_league` before it writes; the database refuses
 * it too (0287), and a write that loses that race answers the same 409, not a raw 400.
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  mockSupabase,
  selectsFor,
  writesTo,
  type ChainResult,
} from '../../common/testing/supabase-chain';
import { LeaguesService } from './leagues.service';

const EVENT = { organization_id: 'org-lyon', event_kind: 'standard', status: 'published' };
const TOURNAMENTS = [
  { id: 't-long', name: 'Longsword Open', entrant_kind: 'individual', event_id: 'e-spring' },
  { id: 't-team', name: 'Team Longsword', entrant_kind: 'team', event_id: 'e-spring' },
  { id: 't-sabre', name: 'Sabre Open', entrant_kind: 'individual', event_id: 'e-spring' },
].map((row) => ({ ...row, events: EVENT }));

// 0287's trigger, as PostgREST passes it on: a write that lost the race with a switch to team.
const TRIGGER_REFUSAL = {
  data: null,
  error: {
    code: '23514',
    message:
      'league_link_individual_only: a League takes individual Tournaments only, and Tournament t-long is a team one',
  },
};

const linkOf = (tournamentId: string, status: string) => ({
  id: 'link-1',
  league_id: 'league-fr',
  tournament_id: tournamentId,
  status,
});

function harness(
  links: ChainResult | ChainResult[] = { data: { id: 'link-1' }, error: null },
  tournaments: Array<Record<string, unknown>> = TOURNAMENTS,
) {
  const db = mockSupabase({
    // A platform admin manages every League: the League door's own bar is not this file's story.
    platform_roles: { data: { role: 'platform_admin' }, error: null },
    tournaments: { rows: tournaments },
    league_groups: { rows: [] },
    league_tournament_links: links,
    league_organization_roles: { data: null, error: null },
  });
  const assertOrgRole = vi.fn().mockResolvedValue(undefined);
  const service = new LeaguesService(db as never, { assertOrgRole } as never, {} as never);
  return { db, service };
}

/** The 409 a door answered, or a failure naming what it did instead. */
async function refusalOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  if (!error) throw new Error('the door was not refused');
  return error as ConflictException;
}

function expectTeamLeagueRefusal(error: ConflictException) {
  expect(error).toBeInstanceOf(ConflictException);
  expect(error.getResponse()).toMatchObject({ reason: 'team_tournament_league' });
}

describe('the organiser asks the League to take a Tournament', () => {
  it('refuses the team Tournament before the write', async () => {
    const { db, service } = harness();

    expectTeamLeagueRefusal(
      await refusalOf(service.requestTournamentLink('league-fr', 't-team', 'u-lyon')),
    );
    expect(writesTo(db, 'league_tournament_links')).toEqual([]);
  });

  it('sends the request for an individual Tournament', async () => {
    const { db, service } = harness();

    await service.requestTournamentLink('league-fr', 't-long', 'u-lyon');

    expect(selectsFor(db.from, 'tournaments')).toEqual([
      '*, events(organization_id, event_kind, status)',
    ]);
    expect(writesTo(db, 'league_tournament_links')[0]?.row).toMatchObject({
      tournament_id: 't-long',
      status: 'requested',
    });
  });

  it('answers the named 409 when the database refuses the request', async () => {
    const { service } = harness(TRIGGER_REFUSAL);

    expectTeamLeagueRefusal(
      await refusalOf(service.requestTournamentLink('league-fr', 't-long', 'u-lyon')),
    );
  });
});

describe('the League manager links a Tournament directly', () => {
  it('refuses the team Tournament before the write', async () => {
    const { db, service } = harness();

    expectTeamLeagueRefusal(
      await refusalOf(service.addTournamentLink('league-fr', 't-team', 'u-league', null)),
    );
    expect(writesTo(db, 'league_tournament_links')).toEqual([]);
  });

  it('links an individual Tournament, reading its kind only', async () => {
    const { db, service } = harness();

    await service.addTournamentLink('league-fr', 't-long', 'u-league', null);

    expect(selectsFor(db.from, 'tournaments')).toEqual(['entrant_kind']);
    expect(writesTo(db, 'league_tournament_links')[0]?.row).toMatchObject({
      tournament_id: 't-long',
      status: 'approved',
    });
  });

  it('answers 404 for a Tournament that does not exist', async () => {
    const { db, service } = harness();

    await expect(
      service.addTournamentLink('league-fr', 't-gone', 'u-league', null),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(writesTo(db, 'league_tournament_links')).toEqual([]);
  });

  it('answers the named 409 when the database refuses the link', async () => {
    const { service } = harness(TRIGGER_REFUSAL);

    expectTeamLeagueRefusal(
      await refusalOf(service.addTournamentLink('league-fr', 't-long', 'u-league', null)),
    );
  });
});

describe('the League manager approves a link again', () => {
  // The link was rejected, so it was not live; the organiser switched the Tournament to team
  // (0287 lets that through); now the old link is approved again.
  it('refuses the approval of a link to a team Tournament before the write', async () => {
    const { db, service } = harness({ data: linkOf('t-team', 'rejected'), error: null });

    expectTeamLeagueRefusal(
      await refusalOf(service.reviewTournamentLink('link-1', { status: 'approved' }, 'u-league')),
    );
    expect(selectsFor(db.from, 'tournaments')).toEqual(['entrant_kind']);
    expect(writesTo(db, 'league_tournament_links')).toEqual([]);
  });

  it('moves that link to another group without reading the kind: only an approval makes it live', async () => {
    const { db, service } = harness({ data: linkOf('t-team', 'rejected'), error: null });

    await service.reviewTournamentLink('link-1', { groupId: null }, 'u-league');

    expect(selectsFor(db.from, 'tournaments')).toEqual([]);
    expect(writesTo(db, 'league_tournament_links')).toHaveLength(1);
  });

  it('approves a link to an individual Tournament', async () => {
    const { db, service } = harness({ data: linkOf('t-long', 'requested'), error: null });

    await service.reviewTournamentLink('link-1', { status: 'approved' }, 'u-league');

    expect(writesTo(db, 'league_tournament_links')[0]?.row).toMatchObject({ status: 'approved' });
  });

  it('answers the named 409 when the database refuses the approval', async () => {
    const { service } = harness([
      { data: linkOf('t-long', 'rejected'), error: null },
      TRIGGER_REFUSAL,
    ]);

    expectTeamLeagueRefusal(
      await refusalOf(service.reviewTournamentLink('link-1', { status: 'approved' }, 'u-league')),
    );
  });
});

/**
 * A Tournament row with no kind (a read whose select left the column out) must not pass for an
 * individual one: each door throws (`storedKind`) and writes nothing, as the rest of the slice does.
 */
describe('a Tournament whose kind was not read', () => {
  const NO_KIND = { id: 't-blank', name: 'Blank', event_id: 'e-spring', events: EVENT };

  const harnessWithoutKind = (links?: ChainResult) => harness(links, [NO_KIND]);

  it.each([
    [
      'the organiser asks',
      (s: LeaguesService) => s.requestTournamentLink('league-fr', 't-blank', 'u'),
    ],
    [
      'the manager links',
      (s: LeaguesService) => s.addTournamentLink('league-fr', 't-blank', 'u', null),
    ],
    [
      'the manager links the Event',
      (s: LeaguesService) => s.addEventTournamentLinks('league-fr', 'e-spring', 'u'),
    ],
  ] as const)('%s: throws, and writes no link', async (_story, door) => {
    const { db, service } = harnessWithoutKind();

    await expect(door(service)).rejects.toThrow("The Tournament's kind was not read");
    expect(writesTo(db, 'league_tournament_links')).toEqual([]);
  });

  it('the manager approves a link again: throws, and writes nothing', async () => {
    const { db, service } = harnessWithoutKind({
      data: linkOf('t-blank', 'rejected'),
      error: null,
    });

    await expect(
      service.reviewTournamentLink('link-1', { status: 'approved' }, 'u-league'),
    ).rejects.toThrow("The Tournament's kind was not read");
    expect(writesTo(db, 'league_tournament_links')).toEqual([]);
  });
});

describe('the League manager links the whole Event', () => {
  it('links the individual Tournaments, skips the team one and names it', async () => {
    const { db, service } = harness();

    const answer = await service.addEventTournamentLinks('league-fr', 'e-spring', 'u-league');

    // The Event's list, then each linked Tournament's kind at the door.
    expect(selectsFor(db.from, 'tournaments')).toEqual([
      'id, name, entrant_kind',
      'entrant_kind',
      'entrant_kind',
    ]);
    expect(writesTo(db, 'league_tournament_links').map((w) => w.row)).toMatchObject([
      { tournament_id: 't-long' },
      { tournament_id: 't-sabre' },
    ]);
    expect(answer).toEqual({ skipped: [{ id: 't-team', name: 'Team Longsword' }] });
  });
});
