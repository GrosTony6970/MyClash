/**
 * staffing.service.test.ts — TDD coverage for the slot-config resolver
 * and the destructive-save guard.
 *
 * The mocks emulate the Supabase chain shape the service uses
 * (`from('table').select(...).eq(...).maybeSingle()` etc.). Each test
 * pushes a sequence of chains via `fromMock.mockReturnValueOnce` in
 * the exact order the service consumes them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  classifyAssignmentsAgainstPayload,
  HARD_CODED_DEFAULT_SLOTS,
  StaffingService,
} from './staffing.service';
import type { StaffingConfigPayloadDto } from './dto/staffing.dto';

// ── Mock helpers ──────────────────────────────────────────────────────────────

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock } };
const mockOrganizations = { assertOrgRole: vi.fn().mockResolvedValue(undefined) };

function makeChain(result: unknown) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    or: vi.fn(),
    order: vi.fn(),
    delete: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  };
  for (const k of ['select', 'eq', 'in', 'or', 'order', 'delete', 'insert', 'update']) {
    (chain as Record<string, unknown>)[k] = vi.fn().mockReturnValue(chain);
  }
  return chain;
}

/** A chain whose terminal `await` returns `result` (no `.maybeSingle`/`.single` step). */
function makeAwaitableChain(result: unknown) {
  const chain = makeChain(result);
  const awaitable = Object.assign(Promise.resolve(result), chain);
  for (const k of ['select', 'eq', 'in', 'or', 'order', 'delete', 'insert', 'update']) {
    (awaitable as unknown as Record<string, unknown>)[k] = vi.fn().mockReturnValue(awaitable);
  }
  return awaitable;
}

function buildPayload(overrides?: Partial<StaffingConfigPayloadDto>): StaffingConfigPayloadDto {
  return {
    pool: [
      { index: 1, displayName: null, allowedSkillIds: ['arbitre_declarant'] },
      { index: 2, displayName: null, allowedSkillIds: ['arbitre_assesseur'] },
      { index: 3, displayName: null, allowedSkillIds: ['arbitre_table'] },
    ],
    bracket: [
      { index: 1, displayName: null, allowedSkillIds: ['arbitre_declarant'] },
      { index: 2, displayName: null, allowedSkillIds: ['arbitre_assesseur'] },
      { index: 3, displayName: null, allowedSkillIds: ['arbitre_table'] },
    ],
    finals: [
      { index: 1, displayName: null, allowedSkillIds: ['arbitre_declarant'] },
      { index: 2, displayName: null, allowedSkillIds: ['arbitre_assesseur'] },
      { index: 3, displayName: null, allowedSkillIds: ['arbitre_table'] },
    ],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('StaffingService', () => {
  let service: StaffingService;

  beforeEach(() => {
    vi.resetAllMocks();
    mockOrganizations.assertOrgRole.mockResolvedValue(undefined);
    service = new StaffingService(mockSupabase as never, mockOrganizations as never);
  });

  describe('getResolvedConfig', () => {
    it('returns the hard-coded floor when no tournament or event rows exist', async () => {
      // tournament lookup → has event_id
      fromMock.mockReturnValueOnce(
        makeChain({ data: { id: 't-1', event_id: 'e-1' }, error: null }),
      );
      // event lookup → has organization_id
      fromMock.mockReturnValueOnce(
        makeChain({ data: { id: 'e-1', organization_id: 'org-1' }, error: null }),
      );
      // tournament_slot_config rows → empty
      fromMock.mockReturnValueOnce(makeAwaitableChain({ data: [], error: null }));
      // event_slot_config_default rows → empty
      fromMock.mockReturnValueOnce(makeAwaitableChain({ data: [], error: null }));

      const result = await service.getResolvedConfig('t-1', 'u-1');

      expect(result.isHardCodedFloor).toBe(true);
      expect(result.inheritsEventDefault).toBe(true);
      expect(result.pool).toEqual(HARD_CODED_DEFAULT_SLOTS);
      expect(result.bracket).toEqual(HARD_CODED_DEFAULT_SLOTS);
      expect(result.finals).toEqual(HARD_CODED_DEFAULT_SLOTS);
      expect(mockOrganizations.assertOrgRole).toHaveBeenCalledWith('org-1', 'u-1', 'scorekeeper');
    });

    it('returns event default when only event rows exist', async () => {
      // tournament lookup
      fromMock.mockReturnValueOnce(
        makeChain({ data: { id: 't-1', event_id: 'e-1' }, error: null }),
      );
      // event lookup
      fromMock.mockReturnValueOnce(
        makeChain({ data: { id: 'e-1', organization_id: 'org-1' }, error: null }),
      );
      // tournament rows → empty
      fromMock.mockReturnValueOnce(makeAwaitableChain({ data: [], error: null }));
      // event slot rows → has pool slot
      fromMock.mockReturnValueOnce(
        makeAwaitableChain({
          data: [
            { id: 'slot-1', phase_type: 'pool', slot_index: 1, display_name: 'Lead' },
            { id: 'slot-2', phase_type: 'pool', slot_index: 2, display_name: null },
          ],
          error: null,
        }),
      );
      // event allowed-skills rows
      fromMock.mockReturnValueOnce(
        makeAwaitableChain({
          data: [
            { slot_config_id: 'slot-1', skill_id: 'arbitre_declarant' },
            { slot_config_id: 'slot-2', skill_id: 'arbitre_assesseur' },
            { slot_config_id: 'slot-2', skill_id: 'arbitre_table' },
          ],
          error: null,
        }),
      );

      const result = await service.getResolvedConfig('t-1', 'u-1');

      expect(result.isHardCodedFloor).toBe(false);
      expect(result.inheritsEventDefault).toBe(true);
      expect(result.pool).toEqual([
        { index: 1, displayName: 'Lead', allowedSkillIds: ['arbitre_declarant'] },
        {
          index: 2,
          displayName: null,
          allowedSkillIds: expect.arrayContaining(['arbitre_assesseur', 'arbitre_table']),
        },
      ]);
      expect(result.bracket).toEqual([]);
      expect(result.finals).toEqual([]);
    });

    it('returns tournament rows when both tournament and event configs exist', async () => {
      fromMock.mockReturnValueOnce(
        makeChain({ data: { id: 't-1', event_id: 'e-1' }, error: null }),
      );
      fromMock.mockReturnValueOnce(
        makeChain({ data: { id: 'e-1', organization_id: 'org-1' }, error: null }),
      );
      // tournament rows → has finals slot
      fromMock.mockReturnValueOnce(
        makeAwaitableChain({
          data: [{ id: 'tslot-1', phase_type: 'finals', slot_index: 1, display_name: null }],
          error: null,
        }),
      );
      // tournament allowed skills
      fromMock.mockReturnValueOnce(
        makeAwaitableChain({
          data: [{ slot_config_id: 'tslot-1', skill_id: 'arbitre_declarant' }],
          error: null,
        }),
      );

      const result = await service.getResolvedConfig('t-1', 'u-1');

      expect(result.isHardCodedFloor).toBe(false);
      expect(result.inheritsEventDefault).toBe(false);
      expect(result.finals).toEqual([
        { index: 1, displayName: null, allowedSkillIds: ['arbitre_declarant'] },
      ]);
      // Event-default branch was NOT consulted.
      expect(fromMock).toHaveBeenCalledTimes(4);
    });
  });

  describe('putTournamentConfig', () => {
    it('throws ConflictException listing affected assignments when role becomes unsupported and confirmDestructive is false', async () => {
      // Tournament + event context lookups
      fromMock.mockReturnValueOnce(
        makeChain({ data: { id: 't-1', event_id: 'e-1' }, error: null }),
      );
      fromMock.mockReturnValueOnce(
        makeChain({ data: { id: 'e-1', organization_id: 'org-1' }, error: null }),
      );
      // Phases for tournament
      fromMock.mockReturnValueOnce(
        makeAwaitableChain({
          data: [{ id: 'phase-pool', type: 'pool' }],
          error: null,
        }),
      );
      // Pools under those phases
      fromMock.mockReturnValueOnce(
        makeAwaitableChain({
          data: [{ id: 'pool-1', phase_id: 'phase-pool' }],
          error: null,
        }),
      );
      // Matches under those phases
      fromMock.mockReturnValueOnce(makeAwaitableChain({ data: [], error: null }));
      // referee_assignments → one row with a role that the new payload disallows
      fromMock.mockReturnValueOnce(
        makeAwaitableChain({
          data: [{ id: 'ra-1', pool_id: 'pool-1', match_id: null, role: 'arbitre_table' }],
          error: null,
        }),
      );

      // Payload drops 'arbitre_table' from the pool config.
      const payload = buildPayload({
        pool: [
          { index: 1, displayName: null, allowedSkillIds: ['arbitre_declarant'] },
          { index: 2, displayName: null, allowedSkillIds: ['arbitre_assesseur'] },
        ],
      });

      await expect(service.putTournamentConfig('t-1', payload, 'u-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects a payload whose slot has no allowed skills', async () => {
      const payload = buildPayload({
        pool: [{ index: 1, displayName: null, allowedSkillIds: [] }],
      });
      await expect(service.putTournamentConfig('t-1', payload, 'u-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a payload with > 6 slots in a phase-type', async () => {
      const tooMany = Array.from({ length: 7 }, (_, i) => ({
        index: i + 1,
        displayName: null,
        allowedSkillIds: ['arbitre_declarant'],
      }));
      const payload = buildPayload({ pool: tooMany });
      await expect(service.putTournamentConfig('t-1', payload, 'u-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('resetTournamentConfig', () => {
    it('deletes the tournament_slot_config rows so future reads fall back', async () => {
      fromMock.mockReturnValueOnce(
        makeChain({ data: { id: 't-1', event_id: 'e-1' }, error: null }),
      );
      fromMock.mockReturnValueOnce(
        makeChain({ data: { id: 'e-1', organization_id: 'org-1' }, error: null }),
      );

      // Delete chain — supabase `.from().delete().eq()` resolves as a promise.
      const deleteResult = Promise.resolve({ error: null });
      const deleteChain = {
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnValue(deleteResult),
      };
      fromMock.mockReturnValueOnce(deleteChain);

      await expect(service.resetTournamentConfig('t-1', 'u-1')).resolves.toBeUndefined();
      expect(mockOrganizations.assertOrgRole).toHaveBeenCalledWith('org-1', 'u-1', 'admin');
      expect(deleteChain.delete).toHaveBeenCalled();
      expect(deleteChain.eq).toHaveBeenCalledWith('tournament_id', 't-1');
    });
  });

  describe('classifyAssignmentsAgainstPayload (pure helper)', () => {
    it('returns rows whose role is not in any of the phase-type slots', () => {
      const payload = buildPayload({
        pool: [{ index: 1, displayName: null, allowedSkillIds: ['arbitre_declarant'] }],
      });
      const out = classifyAssignmentsAgainstPayload(
        [
          { id: 'ra-1', pool_id: 'pool-1', match_id: null, role: 'arbitre_table' },
          { id: 'ra-2', pool_id: 'pool-1', match_id: null, role: 'arbitre_declarant' },
        ],
        payload,
        () => 'pool',
      );
      expect(out).toEqual([
        {
          id: 'ra-1',
          poolId: 'pool-1',
          matchId: null,
          role: 'arbitre_table',
          reason: 'role_not_allowed',
        },
      ]);
    });

    it('skips assignments whose classifier returns null', () => {
      const payload = buildPayload();
      const out = classifyAssignmentsAgainstPayload(
        [{ id: 'ra-x', pool_id: null, match_id: 'm-1', role: 'arbitre_declarant' }],
        payload,
        () => null,
      );
      expect(out).toEqual([]);
    });

    it('skips assignments with no role string (legacy unassigned-but-present)', () => {
      const payload = buildPayload();
      const out = classifyAssignmentsAgainstPayload(
        [{ id: 'ra-x', pool_id: 'pool-1', match_id: null, role: null }],
        payload,
        () => 'pool',
      );
      expect(out).toEqual([]);
    });
  });
});
