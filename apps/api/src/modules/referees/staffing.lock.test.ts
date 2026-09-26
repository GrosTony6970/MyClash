/**
 * A Staffing save that would delete referee assignments waits for the referee board to
 * be unlocked (ADR-019): the referees were told those duties. A save that deletes none
 * goes ahead whether locked or not.
 *
 * The affected-assignment scan is `staffing.service.test.ts`'s; here it is stubbed to say
 * what the save would delete, and the lock read is a seeded table.
 */
import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { HARD_CODED_DEFAULT_SLOTS, StaffingService } from './staffing.service';
import type { StaffingConfigPayloadDto } from './dto/staffing.dto';

const PAYLOAD = {
  pool: [...HARD_CODED_DEFAULT_SLOTS],
  bracket: [...HARD_CODED_DEFAULT_SLOTS],
  finals: [...HARD_CODED_DEFAULT_SLOTS],
  swiss: [...HARD_CODED_DEFAULT_SLOTS],
  confirmDestructive: true,
} as unknown as StaffingConfigPayloadDto;

const AFFECTED = [{ id: 'ra-1', poolId: 'pool-1', matchId: null, role: 'arbitre_table' }];

function makeService(locked: boolean, affected: unknown[]) {
  const supabase = mockSupabase({
    tournaments: { rows: [{ id: 't-1', event_id: 'event-1' }] },
    events: { rows: [{ id: 'event-1', organization_id: 'org-1' }] },
    referee_assignments: {
      rows: locked
        ? [{ id: 'ra-9', event_id: 'event-1', status: 'confirmed', scope_type: 'pool' }]
        : [],
    },
  });
  const service = new StaffingService(
    supabase as never,
    { assertOrgRole: vi.fn().mockResolvedValue(undefined) } as never,
  );
  type Private = {
    computeAffectedAssignmentsForTournament: () => Promise<unknown[]>;
    computeAffectedAssignmentsForEventDefault: () => Promise<unknown[]>;
    replaceTournamentRows: () => Promise<void>;
    replaceEventRows: () => Promise<void>;
    deleteAssignments: () => Promise<void>;
  };
  const inner = service as unknown as Private;
  vi.spyOn(inner, 'computeAffectedAssignmentsForTournament').mockResolvedValue(affected);
  vi.spyOn(inner, 'computeAffectedAssignmentsForEventDefault').mockResolvedValue(affected);
  const replaced = vi.spyOn(inner, 'replaceTournamentRows').mockResolvedValue(undefined);
  vi.spyOn(inner, 'replaceEventRows').mockResolvedValue(undefined);
  const deleted = vi.spyOn(inner, 'deleteAssignments').mockResolvedValue(undefined);
  return { service, replaced, deleted };
}

/** A refusal, or a loud failure when the call went through. */
const unexpected = (): never => {
  throw new Error('expected a refusal');
};

describe('a Staffing save and the referee lock (ADR-019)', () => {
  it.each([
    ['a Tournament', (s: StaffingService) => s.putTournamentConfig('t-1', PAYLOAD, 'u-1')],
    ['the Event default', (s: StaffingService) => s.putEventDefault('event-1', PAYLOAD, 'u-1')],
  ])(
    'saving %s that deletes assignments on a locked board is 409, confirmed or not',
    async (_l, save) => {
      const { service, replaced, deleted } = makeService(true, AFFECTED);

      const error = await save(service).then(unexpected, (e: unknown) => e as ConflictException);

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toMatchObject({ code: 'referee_board_locked' });
      expect(replaced).not.toHaveBeenCalled();
      expect(deleted).not.toHaveBeenCalled();
    },
  );

  it('a save that deletes nothing goes ahead on a locked board', async () => {
    const { service, replaced } = makeService(true, []);
    await expect(service.putTournamentConfig('t-1', PAYLOAD, 'u-1')).resolves.toEqual({
      affectedAssignments: [],
    });
    expect(replaced).toHaveBeenCalled();
  });

  it('an unlocked board deletes the confirmed-destructive rows as before', async () => {
    const { service, deleted } = makeService(false, AFFECTED);
    await service.putTournamentConfig('t-1', PAYLOAD, 'u-1');
    expect(deleted).toHaveBeenCalledWith(['ra-1']);
  });
});
