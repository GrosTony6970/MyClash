import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, selectsFor, type SupabaseRow } from '../../common/testing/supabase-chain';
import type * as MatchLengths from '../schedule/match-lengths';
import { ProgrammeService } from './programme.service';

// The length helper has reads of its own and its own test: every bout is five minutes here.
vi.mock('../schedule/match-lengths', async (importOriginal) => ({
  ...(await importOriginal<typeof MatchLengths>()),
  resolveMatchLengths: vi.fn((_db: unknown, _eventId: string, inputs: Array<{ id: string }>) =>
    Promise.resolve(new Map(inputs.map((input) => [input.id, 5]))),
  ),
}));

/**
 * Team Longsword's two Pools run at the same time on two pistes: Lyon Blades v Paris Fers in Pool
 * 1, Nantes Lames v Lille Fers in Pool 2. A team bout's Registration ids are null (0282). The
 * scheduler keeps a side out of two bouts at once by its key, so every feed hands it the team
 * twins: keyed by Registration, both bouts would share the key of a side not known yet, and
 * Pool 2 would wait for Pool 1.
 */

const START = '2026-11-28T09:00:00.000Z';
const teamBout = (id: string, pool: string, red: string, blue: string): SupabaseRow => ({
  id,
  red_registration_id: null,
  blue_registration_id: null,
  red_team_id: red,
  blue_team_id: blue,
  pool_id: pool,
  match_number_label: `L1-P${pool.slice(-1)}-M1`,
  phase_id: 'phase-1',
  bracket_slot_id: null,
  planned_duration_override_minutes: null,
  lice_id: null,
  scheduled_at: null,
  phases: { tournament_id: 't-team', tournaments: { event_id: 'event-1' } },
});

function makeService(matches: SupabaseRow[]) {
  const supabase = mockSupabase({
    event_programme_configs: {
      rows: [{ event_id: 'event-1', config_json: { matchGapSeconds: 0, minRestMinutes: 0 } }],
    },
    matches: { rows: matches },
    lices: {
      rows: [
        { id: 'l1', name: 'Piste 1', sort_order: 0, event_id: 'event-1' },
        { id: 'l2', name: 'Piste 2', sort_order: 1, event_id: 'event-1' },
      ],
    },
  });
  const placement = { placeMatches: vi.fn(() => Promise.resolve()) };
  const service = new ProgrammeService(supabase as never, {} as never, placement as never);
  return { service, supabase, placement };
}

describe('the scheduler feeds — team bouts', () => {
  it('re-fans two team bouts of four teams side by side on two pistes', async () => {
    const { service, supabase } = makeService([
      teamBout('m-1', 'pool-1', 'team-lyon', 'team-paris'),
      teamBout('m-2', 'pool-2', 'team-nantes', 'team-lille'),
    ]);

    const result = await service.scheduleGroupUnchecked('event-1', {
      matchIds: ['m-1', 'm-2'],
      liceIds: ['l1', 'l2'],
      startTime: START,
      mode: 'pool',
    });

    expect(result.scheduled.map((s) => [s.matchId, s.liceId, s.scheduledAt])).toEqual([
      ['m-1', 'l1', START],
      ['m-2', 'l2', START],
    ]);
    expect(selectsFor(supabase.from, 'matches')).toContain(
      'id, red_registration_id, blue_registration_id, red_team_id, blue_team_id, pool_id, match_number_label, phase_id, bracket_slot_id, planned_duration_override_minutes, phases!inner(tournament_id)',
    );
  });

  it('generates the programme of two team Pools side by side on two pistes', async () => {
    const placed: Array<Record<string, unknown>> = [];
    const supabase = mockSupabase(
      {
        event_programme_configs: {
          rows: [{ event_id: 'event-1', config_json: { matchGapSeconds: 0, minRestMinutes: 0 } }],
        },
        event_programme_blocks: {
          rows: [
            {
              id: 'block-1',
              event_id: 'event-1',
              day_index: 0,
              sort_order: 0,
              block_type: 'competition',
              label: 'Pools',
              competition_id: 't-team',
              competition_phase: 'pool',
              workshop_id: null,
              lice_count: 2,
              start_time: '10:00',
              end_time: '12:00',
              generated_at: null,
            },
          ],
        },
        events: {
          rows: [{ id: 'event-1', start_date: '2026-11-28', timezone: 'Europe/Paris' }],
        },
        lices: {
          rows: [
            { id: 'l1', name: 'Piste 1', sort_order: 0, venue_id: null, event_id: 'event-1' },
            { id: 'l2', name: 'Piste 2', sort_order: 1, venue_id: null, event_id: 'event-1' },
          ],
        },
        tournament_phase_venues: { rows: [] },
        phases: { rows: [{ id: 'phase-1', tournament_id: 't-team', type: 'pool' }] },
        pools: {
          rows: [
            { id: 'pool-1', sort_order: 0, phase_id: 'phase-1' },
            { id: 'pool-2', sort_order: 1, phase_id: 'phase-1' },
          ],
        },
        matches: {
          rows: [
            teamBout('m-1', 'pool-1', 'team-lyon', 'team-paris'),
            teamBout('m-2', 'pool-2', 'team-nantes', 'team-lille'),
          ],
        },
      },
      {
        programme_place_bouts: (args) => {
          placed.push(...(args['p_rows'] as Array<Record<string, unknown>>));
          return { data: placed.length, error: null };
        },
      },
    );
    const orgs = { assertOrgRole: vi.fn().mockResolvedValue(undefined) };
    const service = new ProgrammeService(supabase as never, orgs as never, {} as never);
    vi.spyOn(
      service as unknown as { assertWriter: () => Promise<void> },
      'assertWriter',
    ).mockResolvedValue(undefined);

    await service.generate('event-1', {}, 'user-1');

    const at = (id: string) => placed.find((row) => row['id'] === id);
    expect(typeof at('m-1')?.['scheduled_at']).toBe('string');
    expect(at('m-1')?.['scheduled_at']).toBe(at('m-2')?.['scheduled_at']);
    expect([at('m-1')?.['lice_id'], at('m-2')?.['lice_id']]).toEqual(['l1', 'l2']);
  });

  it('reads the team twins in the Pool, Swiss and bracket feeds', async () => {
    const { service, supabase } = makeService([]);
    const feeds = service as unknown as {
      fetchCompetitionMatches: (tournamentId: string, phase: string | null) => Promise<unknown>;
      loadSwissMatches: (tournamentId: string) => Promise<unknown>;
      loadBracketMatches: (tournamentId: string) => Promise<unknown>;
    };
    const phases = [
      { id: 'ph-pool', tournament_id: 't-team', type: 'pool' },
      { id: 'ph-swiss', tournament_id: 't-team', type: 'swiss' },
      { id: 'ph-elim', tournament_id: 't-team', type: 'single_elim' },
    ];
    const seeded = mockSupabase({
      phases: { rows: phases },
      pools: { rows: [{ id: 'pool-1', sort_order: 0, phase_id: 'ph-pool' }] },
      matches: {
        rows: [
          { ...teamBout('m-1', 'pool-1', 'team-lyon', 'team-paris'), phase_id: 'ph-pool' },
          {
            ...teamBout('m-2', 'pool-x', 'team-a', 'team-b'),
            pool_id: null,
            phase_id: 'ph-swiss',
            swiss_round_id: 'r1',
            swiss_rounds: { round_number: 1 },
          },
          { ...teamBout('m-3', 'pool-x', 'team-c', 'team-d'), pool_id: null, phase_id: 'ph-elim' },
        ],
      },
      bracket_slots: { rows: [] },
    });
    (service as unknown as { supabase: { service: unknown } }).supabase.service = seeded.service;

    const pool = (await feeds.fetchCompetitionMatches('t-team', 'pool')) as SupabaseRow[];
    const swiss = (await feeds.loadSwissMatches('t-team')) as SupabaseRow[];
    const bracket = (await feeds.loadBracketMatches('t-team')) as { rows: SupabaseRow[] };

    expect(pool[0]).toMatchObject({ red_team_id: 'team-lyon', blue_team_id: 'team-paris' });
    expect(swiss[0]).toMatchObject({ red_team_id: 'team-a', blue_team_id: 'team-b' });
    expect(bracket.rows[0]).toMatchObject({ red_team_id: 'team-c', blue_team_id: 'team-d' });
    expect(selectsFor(seeded.from, 'matches')).toEqual([
      'id, red_registration_id, blue_registration_id, red_team_id, blue_team_id, pool_id, match_number_label',
      'id, red_registration_id, blue_registration_id, red_team_id, blue_team_id, pool_id, match_number_label, phase_id, swiss_round_id, swiss_rounds(round_number)',
      'id, red_registration_id, blue_registration_id, red_team_id, blue_team_id, pool_id, match_number_label, phase_id, bracket_slot_id',
    ]);
    expect(supabase.writes).toEqual([]);
  });
});
