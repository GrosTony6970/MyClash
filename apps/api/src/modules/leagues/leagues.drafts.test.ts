/**
 * A draft Tournament, or any Tournament of a draft Event, feeds no league until it is published
 * (ruling 178): its placements are never asked for, so a recompute stores nothing for it and
 * deletes what it stored before — the public league table and the careers never count it. A
 * Tournament read without its statuses counts as hidden: it fails closed.
 */
import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { filtersFor, mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { LeaguesService } from './leagues.service';

const config = {
  scoringSystem: 'ffamhe_tf_2026',
  rankingDimensions: 'weapon',
  tieBreakers: ['total_points'],
};

// A Tournament row as the recompute hands it down: flattened, its Event embed kept.
const tournament = (status: string | undefined, eventStatus: string | undefined) => ({
  id: 't1',
  event_id: 'e1',
  weapon: 'Longsword',
  organization_id: 'org-1',
  event_kind: 'standard',
  status,
  events: { organization_id: 'org-1', event_kind: 'standard', status: eventStatus },
});

type Private = {
  computeTournamentContributions: (
    leagueId: string,
    tournament: unknown,
    groupName: string | null,
    config: unknown,
  ) => Promise<unknown[]>;
  getTournamentWithEvent: (id: string) => Promise<unknown>;
  listEventTournaments: (eventId: string) => Promise<unknown>;
};

function contributions(row: unknown) {
  // Not decided: a reached placement stops there, before any other read.
  const placement = {
    getTournamentPlacements: vi
      .fn()
      .mockResolvedValue({ decided: false, byRegistrationId: new Map(), ordered: [] }),
  };
  const noReads = {
    service: {
      from: vi.fn((table: string) => {
        throw new Error(`unexpected read of ${table}`);
      }),
    },
  };
  const service = new LeaguesService(
    noReads as never,
    {} as never,
    {} as never,
    placement as never,
  );
  const result = (service as unknown as Private).computeTournamentContributions(
    'L1',
    row,
    null,
    config,
  );
  return { result, placement };
}

describe('a draft Tournament feeds no league until it is published (ruling 178)', () => {
  it.each([
    ['a draft Tournament of a published Event', 'draft', 'published'],
    ['a published Tournament of a draft Event', 'published', 'draft'],
    ['a Tournament read without its status', undefined, 'published'],
    ['a Tournament whose Event was read without its status', 'published', undefined],
  ])('contributes nothing for %s, never asking its placements', async (_, status, eventStatus) => {
    const { result, placement } = contributions(tournament(status, eventStatus));
    expect(await result).toEqual([]);
    expect(placement.getTournamentPlacements).not.toHaveBeenCalled();
  });

  it.each(['published', 'running', 'completed'])(
    'asks the placements of a %s Tournament of a published Event',
    async (status) => {
      const { result, placement } = contributions(tournament(status, 'published'));
      await result;
      expect(placement.getTournamentPlacements).toHaveBeenCalledWith('t1');
    },
  );

  describe("the league admin's Recompute re-scores every linked Tournament (ruling 178a)", () => {
    // The Longsword Open went public after its Event completed; the Secret is still a draft.
    const link = (tournamentId: string) => ({
      league_id: 'L1',
      tournament_id: tournamentId,
      status: 'approved',
      tournaments: { name: tournamentId },
      league_groups: null,
    });
    function recompute() {
      const db = mockSupabase({
        leagues: { rows: [{ id: 'L1', finalized_at: null, scoring_config: {} }] },
        league_tournament_links: { rows: [link('t-open'), link('t-secret')] },
        tournaments: {
          rows: [
            { ...tournament('published', 'completed'), id: 't-open' },
            { ...tournament('draft', 'completed'), id: 't-secret' },
          ],
        },
        league_tournament_results: { rows: [] },
      });
      const rpc = vi.fn(async (_name: string, _args: unknown) => ({ data: null, error: null }));
      const placement = {
        getTournamentPlacements: vi
          .fn()
          .mockResolvedValue({ decided: false, byRegistrationId: new Map(), ordered: [] }),
      };
      const scoring = {
        resolveConfig: vi.fn(async () => config),
        computeRankingsFromContributions: vi.fn(() => []),
      };
      const service = new LeaguesService(
        { service: { from: db.from, rpc } } as never,
        {} as never,
        scoring as never,
        placement as never,
      );
      return { run: service.recomputeLeagueRankings('L1'), db, rpc, placement, scoring };
    }

    it('asks the published one its placements, and clears what the draft one stored', async () => {
      const { run, rpc, placement, scoring } = recompute();
      await run;
      expect(placement.getTournamentPlacements.mock.calls).toEqual([['t-open']]);
      const cleared = rpc.mock.calls.filter(
        ([name]) => name === 'replace_league_tournament_results',
      );
      expect(cleared.map(([, args]) => args)).toEqual([
        { p_league_id: 'L1', p_tournament_id: 't-open', p_rows: [] },
        { p_league_id: 'L1', p_tournament_id: 't-secret', p_rows: [] },
      ]);
      // Then it ranks, from the results it just wrote.
      expect(scoring.computeRankingsFromContributions).toHaveBeenCalledTimes(1);
    });

    it('5xxs when the links cannot be read, scoring nothing', async () => {
      const db = mockSupabase({
        leagues: { rows: [{ id: 'L1', finalized_at: null, scoring_config: {} }] },
        league_tournament_links: { data: null, error: { message: 'boom' } },
      });
      const scoring = { resolveConfig: vi.fn(async () => config) };
      const service = new LeaguesService(db as never, {} as never, scoring as never);
      const failure = await service.recomputeLeagueRankings('L1').catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(HttpException);
      expect(String(failure)).toContain('league links read failed: boom');
    });

    it("walks the league's approved links only", async () => {
      const { run, db } = recompute();
      await run;
      expect(filtersFor(db.from, 'league_tournament_links', 'eq')).toEqual([
        ['league_id', 'L1'],
        ['status', 'approved'],
      ]);
    });
  });

  it("reads each linked Tournament with its Event's status", async () => {
    const db = mockSupabase({ tournaments: { rows: [tournament('published', 'published')] } });
    const service = new LeaguesService(db as never, {} as never, {} as never) as unknown as Private;
    await service.getTournamentWithEvent('t1');
    await service.listEventTournaments('e1');
    expect(selectsFor(db.from, 'tournaments')).toEqual([
      '*, events(organization_id, event_kind, status)',
      '*, events(organization_id, event_kind, status)',
    ]);
  });
});
