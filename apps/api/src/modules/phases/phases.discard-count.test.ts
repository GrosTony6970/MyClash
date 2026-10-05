import { ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase, writesTo, type SupabaseRow } from '../../common/testing/supabase-chain';
import { PhasesService } from './phases.service';

/**
 * The yes carries the count (ruling 288).
 *
 * The owner's confirm names one fought bout. While she reads it, the pad on
 * piste 2 starts a second bout. Her yes said "I accept", not "I accept one", and
 * the server deleted both. Now the discard is the count her confirm named: when
 * the server finds another number, it refuses again with its count. The three
 * doors that delete a phase ask the same gate.
 */
const OWNER = 'a0000000-0000-4000-8000-000000000001';
const orgs = { assertOrgRole: vi.fn(() => Promise.resolve()) };
const frozen = {
  rejectPendingEditsForMatch: vi.fn(() => Promise.resolve([])),
  tellClosedByReset: vi.fn(() => Promise.resolve()),
};

/** `fought` bouts of the phase are fought; a fought bout of another phase is a decoy. */
function setup(type: 'pool' | 'single_elim', fought: number) {
  const bouts: SupabaseRow[] = [
    { id: 'bout-1', phase_id: 'phase-1', status: fought >= 1 ? 'completed' : 'scheduled' },
    { id: 'bout-2', phase_id: 'phase-1', status: fought >= 2 ? 'running' : 'scheduled' },
    { id: 'bout-elsewhere', phase_id: 'phase-elsewhere', status: 'completed' },
  ];
  const org = { organization_id: 'org-1' };
  const supabase = mockSupabase({
    phases: {
      rows: [
        {
          id: 'phase-1',
          tournament_id: 'tournament-1',
          type,
          tournaments: { event_id: 'event-1', events: org },
        },
      ],
    },
    tournaments: {
      rows: [{ id: 'tournament-1', weapon: 'longsword', event_id: 'event-1', events: org }],
    },
    matches: { rows: bouts },
    audit_log: { rows: [] },
    registrations: { rows: [] },
  });
  const service = new PhasesService(
    supabase as never,
    { placeMatches: vi.fn(() => Promise.resolve()) } as never,
    undefined,
    orgs as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    frozen as never,
  );
  return { service, supabase };
}

type Door = (service: PhasesService, confirmed: number | undefined) => Promise<unknown>;
const DOORS: Array<[string, 'pool' | 'single_elim', Door]> = [
  [
    'a forced "generate Pools again"',
    'pool',
    (service, confirmed) =>
      service.generatePools('tournament-1', { discardScoredResults: confirmed }, true, OWNER),
  ],
  [
    '"Regenerate bracket"',
    'single_elim',
    (service, confirmed) =>
      service.generateBracket(
        'tournament-1',
        { phaseType: 'single_elim', discardScoredResults: confirmed } as never,
        true,
        OWNER,
      ),
  ],
  [
    '"Delete bracket"',
    'single_elim',
    (service, confirmed) => service.deleteBracketPhase('phase-1', OWNER, confirmed),
  ],
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe.each(DOORS)('%s and the count of the yes (ruling 288)', (_door, type, door) => {
  it('a yes that named 1 is refused when 2 are fought, with the new count', async () => {
    const { service, supabase } = setup(type, 2);

    const thrown = await door(service, 1).then(
      () => null,
      (cause: unknown) => cause,
    );

    expect(thrown).toBeInstanceOf(ConflictException);
    expect((thrown as ConflictException).getResponse()).toMatchObject({
      code: 'scored_bouts_would_be_discarded',
      scoredMatches: 2,
    });
    expect(supabase.writes).toEqual([]);
    expect(orgs.assertOrgRole).not.toHaveBeenCalledWith('org-1', OWNER, 'owner');
  });

  it('a yes that named 2 passes when 2 are fought', async () => {
    const { service, supabase } = setup(type, 2);

    // What follows the delete (a new generation) is not this test's subject.
    await door(service, 2).catch(() => undefined);

    expect(orgs.assertOrgRole).toHaveBeenCalledWith('org-1', OWNER, 'owner');
    expect(writesTo(supabase, 'phases')[0]?.op).toBe('delete');
  });

  // A bout was reset while she read. The count is exact: were "at least" enough,
  // one large number would be a yes to everything.
  it('a yes that named 2 is refused when 1 is fought, with the count', async () => {
    const { service, supabase } = setup(type, 1);

    const thrown = await door(service, 2).then(
      () => null,
      (cause: unknown) => cause,
    );

    expect((thrown as ConflictException).getResponse()).toMatchObject({
      code: 'scored_bouts_would_be_discarded',
      scoredMatches: 1,
    });
    expect(supabase.writes).toEqual([]);
  });
});
