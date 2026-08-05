import { describe, expect, it, vi } from 'vitest';
import { StaffService } from './staff.service';

/** What the matches query asked for, so the tests can assert it never re-truncates. */
interface CapturedQuery {
  select?: string;
  statuses?: unknown;
  limitCalled: boolean;
}

function liceChain() {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        id: 'lice-1',
        name: 'Lice 4',
        event_id: 'ev1',
        events: { id: 'ev1', slug: 'fal-2027', name: 'FAL', status: 'running' },
      },
      error: null,
    }),
  };
}

function assignmentsChain(assignments: Array<Record<string, unknown>>) {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
  };
  chain['in'] = vi.fn().mockResolvedValue({ data: assignments, error: null });
  return chain;
}

/** `referee_skills` resolves through select().in() — one `.eq()` fewer. */
function skillsChain(skills: Array<Record<string, unknown>>) {
  return {
    select: vi.fn(() => ({
      in: vi.fn().mockResolvedValue({ data: skills, error: null }),
    })),
  };
}

function matchesChain(matches: Array<Record<string, unknown>>, captured: CapturedQuery) {
  const chain: Record<string, unknown> = {
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: matches, error: null }),
  };
  chain['select'] = vi.fn((sel: string) => {
    captured.select = sel;
    return chain;
  });
  chain['in'] = vi.fn((_column: string, values: unknown) => {
    captured.statuses = values;
    return chain;
  });
  chain['limit'] = vi.fn(() => {
    captured.limitCalled = true;
    return chain;
  });
  return chain;
}

/**
 * Name-intercepted rather than call-ordered: the method touches three tables,
 * and an ordered `mockReturnValueOnce` chain desyncs the moment a query is
 * added or reordered.
 */
function makeLiceMatchesSupabase(
  matches: Array<Record<string, unknown>>,
  assignments: Array<Record<string, unknown>> = [],
  skills: Array<Record<string, unknown>> = [],
) {
  const captured: CapturedQuery = { limitCalled: false };
  const service = {
    from: vi.fn((table: string) => {
      if (table === 'lices') return liceChain();
      if (table === 'referee_assignments') return assignmentsChain(assignments);
      if (table === 'referee_skills') return skillsChain(skills);
      return matchesChain(matches, captured);
    }),
  };
  return { supabase: { service }, captured };
}

// The piste operator's whole day. The endpoint this replaced truncated three
// separate ways — it filtered `completed` out, capped the query at 8 and sliced
// the queue to 5 — so a played bout was unreachable from the scoring tablet.
// These assertions exist to stop any of the three creeping back.
describe('StaffService.getAssignedLiceMatches', () => {
  function makeService(supabase: unknown) {
    const service = new StaffService(supabase as never, {} as never, {} as never, {} as never);
    const internals = service as unknown as Record<string, unknown>;
    internals['requireStaffFromRequest'] = vi.fn().mockResolvedValue({ id: 'staff-1' });
    internals['isLiceAssigned'] = vi.fn().mockResolvedValue(true);
    return service;
  }

  const mk = (over: Record<string, unknown> = {}) => ({
    id: 'm1',
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
    const { supabase } = makeLiceMatchesSupabase([]);
    const service = makeService(supabase);
    (service as unknown as Record<string, unknown>)['isLiceAssigned'] = vi
      .fn()
      .mockResolvedValue(false);

    await expect(service.getAssignedLiceMatches({} as never, 'lice-1')).rejects.toThrow(
      /not assigned/i,
    );
  });

  it('returns completed matches and never caps the list', async () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      mk({ id: `m${i}`, match_number_label: `M${i}`, scheduled_at: `2026-08-04T13:${i}0:00.000Z` }),
    );
    many[3] = mk({ id: 'played', status: 'completed', red_score: 7, blue_score: 3 });
    const { supabase, captured } = makeLiceMatchesSupabase(many);

    const result = await makeService(supabase).getAssignedLiceMatches({} as never, 'lice-1');

    expect(captured.statuses).toContain('completed');
    expect(captured.limitCalled).toBe(false);
    expect(result.matches).toHaveLength(12);
    const played = result.matches.find((m) => m.id === 'played');
    expect(played).toMatchObject({ status: 'completed', redScore: 7, blueScore: 3 });
  });

  it('selects the columns the list renders plus pool_id for referee precedence', async () => {
    const { supabase, captured } = makeLiceMatchesSupabase([mk()]);
    await makeService(supabase).getAssignedLiceMatches({} as never, 'lice-1');

    for (const column of ['pool_id', 'red_score', 'blue_score', 'scoring_config_json']) {
      expect(captured.select).toContain(column);
    }
  });

  it('renders the lice name raw, so the caller cannot produce "Lice Lice 4"', async () => {
    const { supabase } = makeLiceMatchesSupabase([mk()]);
    const result = await makeService(supabase).getAssignedLiceMatches({} as never, 'lice-1');
    expect(result.liceName).toBe('Lice 4');
  });

  it('attaches referees by scope precedence, match beating pool', async () => {
    const { supabase } = makeLiceMatchesSupabase(
      [mk({ id: 'm1', pool_id: 'p1' }), mk({ id: 'm2', pool_id: 'p1' })],
      [
        {
          scope_type: 'pool',
          match_id: null,
          pool_id: 'p1',
          lice_id: null,
          person_id: 'gp1',
          role: 'arbitre_assesseur',
          global_persons: { given_name: 'Pool', family_name: 'Referee' },
        },
        {
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

    const result = await makeService(supabase).getAssignedLiceMatches({} as never, 'lice-1');

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
    const { supabase } = makeLiceMatchesSupabase([
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

    const result = await makeService(supabase).getAssignedLiceMatches({} as never, 'lice-1');

    expect(result.matches[0]).toMatchObject({
      tournamentId: 't1',
      tournamentName: 'Sidesword',
      phaseType: 'single_elim',
    });
  });

  it('sorts ties numerically, so M2 precedes M10 on the same clock time', async () => {
    const at = '2026-08-04T13:37:00.000Z';
    const { supabase } = makeLiceMatchesSupabase([
      mk({ id: 'm10', match_number_label: 'L1-P1-M10', scheduled_at: at }),
      mk({ id: 'm2', match_number_label: 'L1-P1-M2', scheduled_at: at }),
    ]);

    const result = await makeService(supabase).getAssignedLiceMatches({} as never, 'lice-1');

    expect(result.matches.map((m) => m.id)).toEqual(['m2', 'm10']);
  });
});
