import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { ConflictCheckController } from './conflict-check.controller';
import { mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { assertTournamentMember } from '../../common/auth/event-authz';
import type * as RequestUser from '../../common/auth/request-user';
import type {
  AssignmentBoardPool,
  AssignmentBoardService,
  RefereeConflictEntry,
} from '../referees/assignment-board.service';
import type { OrganizationsService } from '../organizations/organizations.service';
import type { SupabaseService } from '../supabase/supabase.service';

/**
 * The Pools page's referee check (hard rule 8, ADR-016): the membership bar, the
 * Tournament's Event, and the one checker's verdicts over that Event, kept to what
 * concerns the Tournament (`conflict-check-scope.test.ts` holds the filter; the board's
 * own test holds the verdicts, with the real checker).
 */

vi.mock('../../common/auth/request-user', async (importOriginal) => ({
  ...(await importOriginal<typeof RequestUser>()),
  resolveRequestUserId: vi.fn(() => Promise.resolve('user-1')),
}));
vi.mock('../../common/auth/event-authz', () => ({
  assertTournamentMember: vi.fn(() => Promise.resolve('org-1')),
}));

const EVENT = 'event-1';
const TOURNAMENT = 'tournament-1';

const unit = {
  id: 'pool-1',
  tournamentId: TOURNAMENT,
  matches: [],
} as unknown as AssignmentBoardPool;
const own = {
  unitId: 'pool-1',
  tournamentId: TOURNAMENT,
  reasons: [],
} as unknown as RefereeConflictEntry;
const elsewhere = {
  unitId: 'pool-9',
  tournamentId: 'tournament-2',
  reasons: [],
} as unknown as RefereeConflictEntry;

function build(tables: Parameters<typeof mockSupabase>[0]) {
  const supabase = mockSupabase(tables);
  const board = {
    checkEvent: vi.fn(() => Promise.resolve({ conflicts: [own, elsewhere], units: [unit] })),
  };
  const controller = new ConflictCheckController(
    supabase as unknown as SupabaseService,
    {} as OrganizationsService,
    board as unknown as AssignmentBoardService,
  );
  return { supabase, board, controller };
}

const req = {} as FastifyRequest;

describe('ConflictCheckController', () => {
  beforeEach(() => vi.clearAllMocks());

  it("answers the checker's verdicts on the Tournament's Event, kept to this Tournament", async () => {
    const { supabase, board, controller } = build({
      tournaments: { rows: [{ id: TOURNAMENT, event_id: EVENT }] },
    });

    await expect(controller.checkConflicts(TOURNAMENT, req)).resolves.toEqual({ conflicts: [own] });
    expect(board.checkEvent).toHaveBeenCalledWith(EVENT);
    expect(selectsFor(supabase.from, 'tournaments')).toEqual(['event_id']);
  });

  it('checks membership before it reads anything', async () => {
    vi.mocked(assertTournamentMember).mockRejectedValueOnce(new Error('not a member'));
    const { supabase, board, controller } = build({ tournaments: { rows: [] } });

    await expect(controller.checkConflicts(TOURNAMENT, req)).rejects.toThrow('not a member');
    expect(supabase.from).not.toHaveBeenCalled();
    expect(board.checkEvent).not.toHaveBeenCalled();
  });

  it('answers 404 when the Tournament is gone, and judges nothing', async () => {
    const { board, controller } = build({ tournaments: { rows: [] } });
    await expect(controller.checkConflicts(TOURNAMENT, req)).rejects.toThrow(
      new NotFoundException('Tournament not found'),
    );
    expect(board.checkEvent).not.toHaveBeenCalled();
  });

  it('fails when the Tournament read fails, rather than answering an unchecked all-clear', async () => {
    const { controller } = build({ tournaments: { data: null, error: { message: 'boom' } } });
    await expect(controller.checkConflicts(TOURNAMENT, req)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("fails when the checker's reads fail", async () => {
    const { board, controller } = build({
      tournaments: { rows: [{ id: TOURNAMENT, event_id: EVENT }] },
    });
    board.checkEvent.mockRejectedValueOnce(new Error('Could not read the Workshops: boom'));
    await expect(controller.checkConflicts(TOURNAMENT, req)).rejects.toThrow(
      'Could not read the Workshops: boom',
    );
  });
});
