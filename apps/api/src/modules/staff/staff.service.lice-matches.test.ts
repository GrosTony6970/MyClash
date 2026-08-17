import { describe, expect, it, vi } from 'vitest';
import { StaffService } from './staff.service';
import { mockSupabase, selectsFor } from '../../common/testing/supabase-chain';

/**
 * The bouts on one Lice — the piste operator's whole day.
 *
 * Four local chain factories used to answer this, routed by table name, each
 * capturing what the query asked for so the tests could assert the endpoint
 * never re-truncates. The shared seeded double filters the real queries
 * instead, which turns those argument captures into outcomes: a `.limit(8)`
 * creeping back now returns eight rows rather than merely being observed.
 *
 * Decoys throughout: a bout on the neighbouring piste, and a voided one.
 */

const LICE = 'lice-1';
const OTHER_LICE = 'lice-9';

const liceRows = [
  {
    id: OTHER_LICE,
    name: 'Lice 9',
    event_id: 'ev1',
    events: { id: 'ev1', slug: 'fal-2027', name: 'FAL', status: 'running' },
  },
  {
    id: LICE,
    name: 'Lice 4',
    event_id: 'ev1',
    events: { id: 'ev1', slug: 'fal-2027', name: 'FAL', status: 'running' },
  },
];

function buildService(
  matches: Array<Record<string, unknown>>,
  assignments: Array<Record<string, unknown>> = [],
  skills: Array<Record<string, unknown>> = [],
) {
  const supabase = mockSupabase({
    lices: { rows: liceRows },
    matches: { rows: matches },
    referee_assignments: { rows: assignments },
    referee_skills: { rows: skills },
  });
  const service = new StaffService(supabase as never, {} as never, {} as never, {} as never);
  const internals = service as unknown as Record<string, unknown>;
  internals['requireStaffFromRequest'] = vi.fn().mockResolvedValue({ id: 'staff-1' });
  internals['isLiceAssigned'] = vi.fn().mockResolvedValue(true);
  return { service, supabase };
}

// The piste operator's whole day. The endpoint this replaced truncated three
// separate ways — it filtered `completed` out, capped the query at 8 and sliced
// the queue to 5 — so a played bout was unreachable from the scoring tablet.
// These assertions exist to stop any of the three creeping back.
describe('StaffService.getAssignedLiceMatches', () => {
  const mk = (over: Record<string, unknown> = {}) => ({
    id: 'm1',
    // Carried now that the fixture FILTERS: the read is scoped by lice_id, so a
    // row without one is a row this piste never sees.
    lice_id: LICE,
    status: 'scheduled',
    pool_id: null,
    scheduled_at: '2026-08-04T13:37:00.000Z',
    match_number_label: 'M1',
    red_score: 0,
    blue_score: 0,
    phases: {
      config_json: null,
      tournaments: { name: 'Sidesword', weapon: 'sidesword', scoring_config_json: null },
    },
    pools: null,
    bracket_slots: null,
    swiss_rounds: null,
    red: { persons: { given_name: 'Adrián', family_name: 'Dader Laguna' } },
    blue: { persons: { given_name: 'Valentin', family_name: 'Arrois' } },
    ...over,
  });

  it('refuses a lice the staff account is not assigned to', async () => {
    const { service } = buildService([]);
    (service as unknown as Record<string, unknown>)['isLiceAssigned'] = vi
      .fn()
      .mockResolvedValue(false);

    await expect(service.getAssignedLiceMatches({} as never, LICE)).rejects.toThrow(
      /not assigned/i,
    );
  });

  it('returns completed matches and never caps the list', async () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      mk({ id: `m${i}`, match_number_label: `M${i}`, scheduled_at: `2026-08-04T13:${i}0:00.000Z` }),
    );
    many[3] = mk({ id: 'played', status: 'completed', red_score: 7, blue_score: 3 });
    // Two decoys the reads must reject: a bout on the neighbouring piste, and a
    // voided one, which is outside the status window on this piste.
    many.push(mk({ id: 'm-elsewhere', lice_id: OTHER_LICE }));
    many.push(mk({ id: 'm-void', status: 'voided' }));
    const { service } = buildService(many);

    const result = await service.getAssignedLiceMatches({} as never, LICE);

    // Outcomes now, not captured arguments: a `.limit(8)` creeping back returns
    // eight rows, and dropping `completed` from the status window loses the
    // played bout. The old assertions could only watch the query go past.
    expect(result.matches).toHaveLength(12);
    const played = result.matches.find((m) => m.id === 'played');
    expect(played).toMatchObject({ status: 'completed', redScore: 7, blueScore: 3 });
  });

  it('selects the columns the list renders plus pool_id for referee precedence', async () => {
    // Still an argument assertion, and has to be: the double ignores the
    // projection, so a value-only test stays green with the column deleted.
    const { service, supabase } = buildService([mk()]);
    await service.getAssignedLiceMatches({} as never, LICE);

    const [projection] = selectsFor(supabase.from, 'matches');
    for (const column of ['pool_id', 'red_score', 'blue_score', 'scoring_config_json']) {
      expect(projection).toContain(column);
    }
  });

  it('renders the lice name raw, so the caller cannot produce "Lice Lice 4"', async () => {
    const { service } = buildService([mk()]);
    const result = await service.getAssignedLiceMatches({} as never, LICE);
    expect(result.liceName).toBe('Lice 4');
  });

  it('attaches referees by scope precedence, match beating pool', async () => {
    const { service } = buildService(
      [mk({ id: 'm1', pool_id: 'p1' }), mk({ id: 'm2', pool_id: 'p1' })],
      [
        {
          event_id: 'ev1',
          status: 'assigned',
          scope_type: 'pool',
          match_id: null,
          pool_id: 'p1',
          lice_id: null,
          person_id: 'gp1',
          role: 'arbitre_assesseur',
          global_persons: { given_name: 'Pool', family_name: 'Referee' },
        },
        {
          event_id: 'ev1',
          status: 'assigned',
          scope_type: 'match',
          match_id: 'm2',
          pool_id: null,
          lice_id: null,
          person_id: 'gp2',
          role: 'arbitre_declarant',
          global_persons: { given_name: 'Match', family_name: 'Referee' },
        },
      ],
      [
        { id: 'arbitre_assesseur', name: 'Assesseur', color: 'blue' },
        { id: 'arbitre_declarant', name: 'Déclarant', color: 'orange' },
      ],
    );

    const result = await service.getAssignedLiceMatches({} as never, LICE);

    expect(result.matches.find((m) => m.id === 'm1')?.referees).toEqual([
      {
        name: 'Pool Referee',
        role: 'arbitre_assesseur',
        roleLabel: 'Assesseur',
        roleColor: 'blue',
        status: 'assigned',
      },
    ]);
    expect(result.matches.find((m) => m.id === 'm2')?.referees).toEqual([
      {
        name: 'Match Referee',
        role: 'arbitre_declarant',
        roleLabel: 'Déclarant',
        roleColor: 'orange',
        status: 'assigned',
      },
    ]);
  });

  it('carries the tournament id and phase type the pool/bracket views need', async () => {
    // Both were already joined by LICE_MATCH_SELECT and thrown away; without
    // them the screen cannot fetch a bracket or standings at all.
    const { service } = buildService([
      mk({
        phases: {
          type: 'single_elim',
          config_json: null,
          tournaments: {
            id: 't1',
            name: 'Sidesword',
            weapon: 'sidesword',
            scoring_config_json: null,
          },
        },
      }),
    ]);

    const result = await service.getAssignedLiceMatches({} as never, LICE);

    expect(result.matches[0]).toMatchObject({
      tournamentId: 't1',
      tournamentName: 'Sidesword',
      phaseType: 'single_elim',
    });
  });

  it('sorts ties numerically, so M2 precedes M10 on the same clock time', async () => {
    const at = '2026-08-04T13:37:00.000Z';
    const { service } = buildService([
      mk({ id: 'm10', match_number_label: 'L1-P1-M10', scheduled_at: at }),
      mk({ id: 'm2', match_number_label: 'L1-P1-M2', scheduled_at: at }),
    ]);

    const result = await service.getAssignedLiceMatches({} as never, LICE);

    expect(result.matches.map((m) => m.id)).toEqual(['m2', 'm10']);
  });
});
