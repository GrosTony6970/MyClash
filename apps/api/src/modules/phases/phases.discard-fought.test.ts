import { ConflictException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mockSupabase,
  queriedTables,
  scopedTo,
  writesTo,
  type SupabaseRow,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { PhasesService } from './phases.service';

/**
 * The doors that delete fought bouts (rulings 276, 277, 279, 280, 285).
 *
 * Three doors delete a whole phase, and its bouts go with it: the forced
 * "generate Pools again", "Regenerate bracket" and "Delete bracket". When a
 * bout of the phase was fought:
 *
 *   - only the organisation's OWNER passes, and an admin is told so by a code
 *     the screens say in the reader's language;
 *   - every door wants the discard said out loud (`discardScoredResults`), and
 *     its refusal carries the SERVER's count, which the page shows in a confirm:
 *     a page's own count can be a bout late (ruling 285).
 *
 * Marie asked to void a hit of a semi-final. Her request waits on that hit. The
 * bout is deleted, and her request goes with it (ON DELETE CASCADE): so it is
 * closed first, and she is told once the delete has run.
 */
const OWNER = 'a0000000-0000-4000-8000-000000000001';
const ADMIN = 'a0000000-0000-4000-8000-000000000002';
const CLOSED = [{ id: 'request-of-marie' }];

const orgs = { assertOrgRole: vi.fn() };

/** An owner passes every bar, an admin every bar but `owner`. */
function letIn(userId: string) {
  orgs.assertOrgRole.mockImplementation((_org: string, _user: string, role: string) =>
    role === 'owner' && userId !== OWNER
      ? Promise.reject(new ForbiddenException('Requires owner role or higher'))
      : Promise.resolve(),
  );
}

const PHASE_ORG = { event_id: 'event-1', events: { organization_id: 'org-1' } };

/**
 * The phase under threat holds one fought bout and one unplayed bout. A fought
 * bout of ANOTHER phase is a decoy for every read that names the phase.
 */
function bouts(phaseId: string, fought: boolean): SupabaseRow[] {
  return [
    { id: 'bout-fought', phase_id: phaseId, status: fought ? 'completed' : 'scheduled' },
    { id: 'bout-unplayed', phase_id: phaseId, status: 'scheduled' },
    { id: 'bout-elsewhere', phase_id: 'phase-elsewhere', status: 'completed' },
  ];
}

function setup(seed: Record<string, TableSeed>) {
  const supabase = mockSupabase(seed);
  /** What had been written to `phases` when each step of the guard ran. */
  const seen = { atClose: -1, atTelling: -1 };
  const frozen = {
    rejectPendingEditsForMatch: vi.fn(() => {
      seen.atClose = writesTo(supabase, 'phases').length;
      return Promise.resolve(CLOSED);
    }),
    tellClosedByReset: vi.fn(() => {
      seen.atTelling = writesTo(supabase, 'phases').length;
      return Promise.resolve();
    }),
  };
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
  return { service, supabase, frozen, seen };
}

const refusal = async (attempt: Promise<unknown>) => {
  const thrown = await attempt.then(
    () => null,
    (cause: unknown) => cause,
  );
  return {
    thrown,
    body: (thrown as { getResponse?: () => unknown } | null)?.getResponse?.() ?? null,
  };
};

const ONLY_THE_OWNER = {
  message: 'Only the owner of the organisation can delete bouts that have been fought.',
  code: 'discard_requires_owner',
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Generate Pools again ──────────────────────────────────────────────────────

describe('a forced "generate Pools again" over fought bouts', () => {
  const pools = (fought: boolean, phases: TableSeed = { rows: [POOL_PHASE] }) =>
    setup({
      phases,
      tournaments: {
        rows: [{ id: 'tournament-1', weapon: 'longsword', event_id: 'event-1', events: ORG }],
      },
      matches: { rows: bouts('pool-phase', fought) },
      registrations: { rows: [] },
    });
  const POOL_PHASE = { id: 'pool-phase', tournament_id: 'tournament-1', type: 'pool' };
  const ORG = { organization_id: 'org-1' };
  const generate = (s: ReturnType<typeof setup>, userId: string, discard?: boolean) =>
    s.service.generatePools(
      'tournament-1',
      discard === undefined ? {} : { discardScoredResults: discard },
      true,
      userId,
    );

  it('with no discard said: refused with a code and the count, and nothing is touched', async () => {
    letIn(OWNER);
    const s = pools(true);

    const { thrown, body } = await refusal(generate(s, OWNER));

    expect(thrown).toBeInstanceOf(ConflictException);
    expect(body).toMatchObject({
      code: 'scored_bouts_would_be_discarded',
      phaseId: 'pool-phase',
      scoredMatches: 1,
    });
    expect(s.supabase.writes).toEqual([]);
    expect(s.frozen.rejectPendingEditsForMatch).not.toHaveBeenCalled();
  });

  it('an admin who says the discard is told only the owner may', async () => {
    letIn(ADMIN);
    const s = pools(true);

    const { thrown, body } = await refusal(generate(s, ADMIN, true));

    expect(thrown).toBeInstanceOf(ForbiddenException);
    expect(body).toEqual(ONLY_THE_OWNER);
    expect(orgs.assertOrgRole).toHaveBeenCalledWith('org-1', ADMIN, 'owner');
    expect(s.supabase.writes).toEqual([]);
    expect(s.frozen.rejectPendingEditsForMatch).not.toHaveBeenCalled();
  });

  // "Could not read the membership" is not "you are not the owner".
  it('a failed membership read stays an error, with no code', async () => {
    orgs.assertOrgRole.mockRejectedValue(new Error('membership read failed: away'));
    const s = pools(true);

    const { thrown, body } = await refusal(generate(s, OWNER, true));

    expect((thrown as Error).message).toBe('membership read failed: away');
    expect(body).toBeNull();
    expect(s.supabase.writes).toEqual([]);
  });

  it('the owner’s discard closes the requests of every bout of the phase, then deletes it', async () => {
    letIn(OWNER);
    const s = pools(true);

    // The generation that follows the delete is not this test's subject.
    await generate(s, OWNER, true).catch(() => undefined);

    expect(s.frozen.rejectPendingEditsForMatch.mock.calls).toEqual([
      [['bout-fought', 'bout-unplayed'], OWNER, 'bout_deleted'],
    ]);
    expect(s.seen.atClose).toBe(0);
    const [dropped] = writesTo(s.supabase, 'phases');
    expect(dropped?.op).toBe('delete');
    expect(scopedTo(dropped, 'id')).toBe('pool-phase');
    // Told once the bouts are gone: no step of the delete waits on a notice.
    expect(s.frozen.tellClosedByReset.mock.calls).toEqual([[CLOSED]]);
    expect(s.seen.atTelling).toBeGreaterThanOrEqual(1);
  });

  it('a clean regeneration asks no owner, and still closes what waits on the phase', async () => {
    letIn(ADMIN);
    const s = pools(false);

    await generate(s, ADMIN).catch(() => undefined);

    expect(orgs.assertOrgRole).not.toHaveBeenCalledWith('org-1', ADMIN, 'owner');
    expect(writesTo(s.supabase, 'phases')[0]?.op).toBe('delete');
    expect(s.frozen.rejectPendingEditsForMatch.mock.calls).toEqual([
      [['bout-fought', 'bout-unplayed'], ADMIN, 'bout_deleted'],
    ]);
  });

  // The close is saved by then: who asked is told whatever the delete answers.
  it('a delete that fails is an error, and who asked is still told', async () => {
    letIn(OWNER);
    const s = pools(true, [
      { data: POOL_PHASE, error: null },
      { data: null, error: { message: 'the phase stayed' } },
    ]);

    const { thrown } = await refusal(generate(s, OWNER, true));

    expect((thrown as Error).message).toBe('the phase stayed');
    // Stopped AT the delete: unchecked, the generation went on over the old bouts.
    expect(queriedTables(s.supabase.from)).not.toContain('registrations');
    expect(s.frozen.tellClosedByReset.mock.calls).toEqual([[CLOSED]]);
  });
});

// ── Regenerate bracket ────────────────────────────────────────────────────────

describe('"Regenerate bracket" over fought bouts (ruling 279)', () => {
  const BRACKET = {
    id: 'bracket-phase',
    tournament_id: 'tournament-1',
    type: 'single_elim',
    tournaments: PHASE_ORG,
  };
  const bracket = (fought: boolean) =>
    setup({
      phases: { rows: [BRACKET] },
      tournaments: { rows: [{ id: 'tournament-1', events: { organization_id: 'org-1' } }] },
      matches: { rows: bouts('bracket-phase', fought) },
      audit_log: { rows: [] },
      registrations: { rows: [] },
    });
  const regenerate = (s: ReturnType<typeof setup>, userId?: string, discard?: boolean) =>
    s.service.generateBracket(
      'tournament-1',
      { phaseType: 'single_elim', discardScoredResults: discard } as never,
      true,
      userId,
    );

  it('with no discard said: the owner is refused with the count, and the bracket stays', async () => {
    letIn(OWNER);
    const s = bracket(true);

    const { thrown, body } = await refusal(regenerate(s, OWNER));

    expect(thrown).toBeInstanceOf(ConflictException);
    expect(body).toMatchObject({
      code: 'scored_bouts_would_be_discarded',
      phaseId: 'bracket-phase',
      scoredMatches: 1,
    });
    expect(s.supabase.writes).toEqual([]);
    expect(s.frozen.rejectPendingEditsForMatch).not.toHaveBeenCalled();
  });

  it('an admin who says the discard is told only the owner may, and the bracket stays', async () => {
    letIn(ADMIN);
    const s = bracket(true);

    const { thrown, body } = await refusal(regenerate(s, ADMIN, true));

    expect(thrown).toBeInstanceOf(ForbiddenException);
    expect(body).toEqual(ONLY_THE_OWNER);
    expect(s.supabase.writes).toEqual([]);
    expect(s.frozen.rejectPendingEditsForMatch).not.toHaveBeenCalled();
  });

  it('the owner passes: the requests are closed, the bracket is deleted, who asked is told', async () => {
    letIn(OWNER);
    const s = bracket(true);

    await regenerate(s, OWNER, true).catch(() => undefined);

    expect(orgs.assertOrgRole).toHaveBeenCalledWith('org-1', OWNER, 'owner');
    expect(s.frozen.rejectPendingEditsForMatch.mock.calls).toEqual([
      [['bout-fought', 'bout-unplayed'], OWNER, 'bout_deleted'],
    ]);
    expect(s.seen.atClose).toBe(0);
    expect(scopedTo(writesTo(s.supabase, 'phases')[0], 'id')).toBe('bracket-phase');
    expect(s.frozen.tellClosedByReset.mock.calls).toEqual([[CLOSED]]);
  });

  it('a bracket with no fought bout stays an admin’s to redraw', async () => {
    letIn(ADMIN);
    const s = bracket(false);

    await regenerate(s, ADMIN).catch(() => undefined);

    expect(orgs.assertOrgRole).not.toHaveBeenCalledWith('org-1', ADMIN, 'owner');
    expect(writesTo(s.supabase, 'phases')[0]?.op).toBe('delete');
  });

  // No route sends it: the default actor names nobody who can accept the loss.
  it('the system actor never discards fought bouts, whatever it says', async () => {
    const s = bracket(true);

    const { thrown } = await refusal(regenerate(s, undefined, true));

    expect(thrown).toBeInstanceOf(ForbiddenException);
    expect(s.supabase.writes).toEqual([]);
  });
});

// ── Delete bracket ────────────────────────────────────────────────────────────

describe('"Delete bracket" over fought bouts (ruling 279)', () => {
  const remove = (fought: boolean) =>
    setup({
      phases: {
        rows: [
          {
            id: 'bracket-phase',
            tournament_id: 'tournament-1',
            type: 'single_elim',
            tournaments: PHASE_ORG,
          },
        ],
      },
      matches: { rows: bouts('bracket-phase', fought) },
      audit_log: { rows: [] },
    });

  it('with no discard said: the owner is refused with the count, and the bracket stays', async () => {
    letIn(OWNER);
    const s = remove(true);

    const { thrown, body } = await refusal(s.service.deleteBracketPhase('bracket-phase', OWNER));

    expect(thrown).toBeInstanceOf(ConflictException);
    expect(body).toMatchObject({ code: 'scored_bouts_would_be_discarded', scoredMatches: 1 });
    expect(s.supabase.writes).toEqual([]);
    expect(s.frozen.rejectPendingEditsForMatch).not.toHaveBeenCalled();
  });

  it('an admin who says the discard is told only the owner may, and the bracket stays', async () => {
    letIn(ADMIN);
    const s = remove(true);

    const { thrown, body } = await refusal(
      s.service.deleteBracketPhase('bracket-phase', ADMIN, true),
    );

    expect(thrown).toBeInstanceOf(ForbiddenException);
    expect(body).toEqual(ONLY_THE_OWNER);
    expect(s.supabase.writes).toEqual([]);
  });

  it('the owner passes: the requests are closed, the bracket is deleted, who asked is told', async () => {
    letIn(OWNER);
    const s = remove(true);

    await s.service.deleteBracketPhase('bracket-phase', OWNER, true);

    expect(s.frozen.rejectPendingEditsForMatch.mock.calls).toEqual([
      [['bout-fought', 'bout-unplayed'], OWNER, 'bout_deleted'],
    ]);
    expect(s.seen.atClose).toBe(0);
    expect(writesTo(s.supabase, 'phases')[0]?.op).toBe('delete');
    expect(s.frozen.tellClosedByReset.mock.calls).toEqual([[CLOSED]]);
    expect(s.seen.atTelling).toBe(1);
  });

  it('a bracket with no fought bout stays an admin’s to delete', async () => {
    letIn(ADMIN);
    const s = remove(false);

    await s.service.deleteBracketPhase('bracket-phase', ADMIN);

    expect(orgs.assertOrgRole.mock.calls).toEqual([['org-1', ADMIN, 'admin']]);
    expect(writesTo(s.supabase, 'phases')[0]?.op).toBe('delete');
  });
});
