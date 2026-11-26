/**
 * The Tournament's kind through its doors: the create, the save, and `GET /tournaments/:id`.
 *
 * The story: Lyon creates "Team Longsword" as a team Tournament of teams of 3, then changes its
 * mind; a second club creates an individual one. The kind in force is the body's, else the stored
 * one. Once the Tournament holds an entrant the database refuses a change of kind, and the save
 * answers the 409 a screen can name.
 */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as MatchRuleset from '../phases/match-ruleset';
import { assertOrgRole as createRole, seedHarness } from './create-tournament.fixtures';
import { assertOrgRole, harness, ON_TF_1_0_0, type Row } from './rules-write.fixtures';
import { selectsFor, writesTo } from '../../common/testing/supabase-chain';

vi.mock('../phases/match-ruleset', async (original) => ({
  ...(await original<typeof MatchRuleset>()),
  restampUnstartedMatches: vi.fn(() => Promise.resolve()),
}));

const BODY = { slug: 'team-longsword', name: 'Team Longsword', rulesetCode: 'TF_v1' };
const INDIVIDUAL: Row = { ...ON_TF_1_0_0, entrant_kind: 'individual', max_waitlist: 6 };
const TEAM: Row = {
  ...ON_TF_1_0_0,
  entrant_kind: 'team',
  team_default_size: 3,
  max_waitlist: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  assertOrgRole.mockResolvedValue(undefined);
  createRole.mockResolvedValue(undefined);
});

/** The 400 or 409 a door answered: its class and body. */
async function refusalOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  if (!error) throw new Error('the door was not refused');
  return error as BadRequestException | ConflictException;
}

describe('the create', () => {
  it('writes a team Tournament and its team size', async () => {
    const { svc, inserted } = seedHarness();

    await svc.createTournament(
      'e1',
      { ...BODY, entrantKind: 'team', teamDefaultSize: 3, maxWaitlist: null } as never,
      'u1',
    );

    expect(inserted()).toMatchObject({
      entrant_kind: 'team',
      team_default_size: 3,
      max_waitlist: null,
    });
  });

  it('writes an individual Tournament, with no team size, when no kind is sent', async () => {
    const { svc, inserted } = seedHarness();

    await svc.createTournament('e1', { ...BODY, maxWaitlist: 4 } as never, 'u1');

    expect(inserted()).toMatchObject({
      entrant_kind: 'individual',
      team_default_size: null,
      max_waitlist: 4,
    });
  });

  it.each([
    ['a waitlist cap', { maxWaitlist: 4 }, 'maxWaitlist'],
    ['forfeit rules', { forfeitRules: { secondBlackCard: 'match' } }, 'forfeitRules'],
  ])('refuses a team Tournament with %s, and writes nothing', async (_what, extra, field) => {
    const { svc, inserted } = seedHarness();

    const error = await refusalOf(
      svc.createTournament('e1', { ...BODY, entrantKind: 'team', ...extra } as never, 'u1'),
    );

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse()).toMatchObject({ code: 'entrant_kind_field', field });
    expect(inserted()).toBeNull();
  });
});

describe('the save', () => {
  it('switches an empty individual Tournament to team, clearing its waitlist cap', async () => {
    const h = harness(INDIVIDUAL);

    await h.svc.updateTournament('t1', { entrantKind: 'team', teamDefaultSize: 4 } as never, 'u1');

    expect(writesTo(h.db, 'tournaments').map((w) => w.row)).toEqual([
      expect.objectContaining({ entrant_kind: 'team', team_default_size: 4, max_waitlist: null }),
    ]);
  });

  it('switches a team Tournament to individual, clearing its team size', async () => {
    const h = harness(TEAM);

    await h.svc.updateTournament('t1', { entrantKind: 'individual' } as never, 'u1');

    const [write] = writesTo(h.db, 'tournaments');
    expect(write?.row).toMatchObject({ entrant_kind: 'individual', team_default_size: null });
    expect(write?.row).not.toHaveProperty('max_waitlist');
  });

  it.each([
    ['a waitlist cap', { maxWaitlist: 4 }, 'maxWaitlist'],
    ['forfeit rules', { forfeitRules: { secondBlackCard: 'match' } }, 'forfeitRules'],
  ])('refuses %s on a STORED team Tournament, and writes nothing', async (_what, body, field) => {
    const h = harness(TEAM);

    const error = await refusalOf(h.svc.updateTournament('t1', body as never, 'u1'));

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse()).toMatchObject({ code: 'entrant_kind_field', field });
    expect(writesTo(h.db, 'tournaments')).toEqual([]);
  });

  it("accepts the Basics save's cleared waitlist cap on a team Tournament", async () => {
    const h = harness(TEAM);

    await h.svc.updateTournament('t1', { name: 'Team Sabre', maxWaitlist: null } as never, 'u1');

    expect(writesTo(h.db, 'tournaments')[0]?.row).toMatchObject({
      name: 'Team Sabre',
      max_waitlist: null,
    });
  });

  it('judges the waitlist cap against the kind the body sends, not the stored one', async () => {
    const back = harness(TEAM);
    await back.svc.updateTournament(
      't1',
      { entrantKind: 'individual', maxWaitlist: 4 } as never,
      'u1',
    );
    expect(writesTo(back.db, 'tournaments')[0]?.row).toMatchObject({ max_waitlist: 4 });

    const forth = harness(INDIVIDUAL);
    const error = await refusalOf(
      forth.svc.updateTournament('t1', { entrantKind: 'team', maxWaitlist: 4 } as never, 'u1'),
    );
    expect(error).toBeInstanceOf(BadRequestException);
  });

  it('answers 409 entrant_kind_settled when the database refuses the change of kind', async () => {
    const h = harness(
      INDIVIDUAL,
      {},
      {
        tournaments: [
          { data: { ...INDIVIDUAL }, error: null },
          {
            data: null,
            error: {
              code: '23514',
              message:
                'entrant_kind_is_settled: Tournament t1 has entrants, so its kind stays individual',
            } as never,
          },
        ],
      },
    );

    const error = await refusalOf(
      h.svc.updateTournament('t1', { entrantKind: 'team' } as never, 'u1'),
    );

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ reason: 'entrant_kind_settled' });
  });

  // Ruling 989: an empty individual Tournament given a double elimination bracket, then switched to
  // team.
  it('answers 409 kind_locked_by_phase when the Tournament has a phase', async () => {
    const h = harness(
      INDIVIDUAL,
      {},
      {
        tournaments: [
          { data: { ...INDIVIDUAL }, error: null },
          {
            data: null,
            error: {
              code: '23514',
              message:
                'entrant_kind_set_before_phases: Tournament t1 has a phase, so its kind stays individual',
            } as never,
          },
        ],
      },
    );

    const error = await refusalOf(
      h.svc.updateTournament('t1', { entrantKind: 'team' } as never, 'u1'),
    );

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ reason: 'kind_locked_by_phase' });
  });

  // Ruling 981: an empty individual Tournament linked to a League by mistake, then switched to team.
  it('answers 409 league_link_blocks_team when the Tournament has a live League link', async () => {
    const h = harness(
      INDIVIDUAL,
      {},
      {
        tournaments: [
          { data: { ...INDIVIDUAL }, error: null },
          {
            data: null,
            error: {
              code: '23514',
              message:
                'league_link_blocks_team: Tournament t1 has a live League link, so it stays individual',
            } as never,
          },
        ],
      },
    );

    const error = await refusalOf(
      h.svc.updateTournament('t1', { entrantKind: 'team' } as never, 'u1'),
    );

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ reason: 'league_link_blocks_team' });
  });
});

describe('the read', () => {
  it('counts every Registration whatever its status, and every team, as the trigger does', async () => {
    const statuses = ['registered', 'checked_in', 'waitlist', 'withdrawn', 'disqualified'];
    const h = harness(
      INDIVIDUAL,
      {},
      {
        registrations: {
          rows: [
            ...statuses.map((status, i) => ({ id: `r${i}`, tournament_id: 't1', status })),
            { id: 'r-other', tournament_id: 't2', status: 'registered' },
          ],
        },
        teams: { rows: [{ id: 'tm-other', tournament_id: 't2' }] },
      },
    );

    const read = (await h.getTournament()) as Row;

    expect(read['entrant_count']).toBe(5);
    expect(selectsFor(h.db.from, 'registrations')).toEqual(['id']);
    expect(selectsFor(h.db.from, 'teams')).toEqual(['id']);
  });

  it("counts a team Tournament's teams", async () => {
    const h = harness(
      TEAM,
      {},
      {
        teams: {
          rows: [
            { id: 'tm1', tournament_id: 't1' },
            { id: 'tm2', tournament_id: 't1' },
          ],
        },
      },
    );

    const read = (await h.getTournament()) as Row;

    expect(read).toMatchObject({ entrant_kind: 'team', team_default_size: 3, entrant_count: 2 });
  });
});
