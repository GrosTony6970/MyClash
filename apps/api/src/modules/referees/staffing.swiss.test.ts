/**
 * staffing.swiss.test.ts — the Swiss slot-config bucket.
 *
 * Split out of `staffing.service.test.ts` to keep both files under the
 * complexity gate's 400-line file budget. Same mock shape: each test pushes a
 * sequence of Supabase chains via `fromMock.mockReturnValueOnce` in the exact
 * order the service consumes them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyAssignmentsAgainstPayload, StaffingService } from './staffing.service';
import type { StaffingConfigPayloadDto } from './dto/staffing.dto';

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock } };
const mockOrganizations = { assertOrgRole: vi.fn().mockResolvedValue(undefined) };

function makeChain(result: unknown) {
  const chain: Record<string, unknown> = {
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  };
  for (const k of ['select', 'eq', 'in', 'or', 'order', 'delete', 'insert', 'update']) {
    chain[k] = vi.fn().mockReturnValue(chain);
  }
  return chain;
}

/** A chain whose terminal `await` returns `result` (no `.maybeSingle`/`.single` step). */
function makeAwaitableChain(result: unknown) {
  const awaitable = Object.assign(Promise.resolve(result), makeChain(result));
  for (const k of ['select', 'eq', 'in', 'or', 'order', 'delete', 'insert', 'update']) {
    (awaitable as unknown as Record<string, unknown>)[k] = vi.fn().mockReturnValue(awaitable);
  }
  return awaitable;
}

const THREE_SLOTS = [
  { index: 1, displayName: null, allowedSkillIds: ['arbitre_declarant'] },
  { index: 2, displayName: null, allowedSkillIds: ['arbitre_assesseur'] },
  { index: 3, displayName: null, allowedSkillIds: ['arbitre_table'] },
];

/** Deliberately omits `swiss` — the shape a client predating the format sends. */
function buildPayload(overrides?: Partial<StaffingConfigPayloadDto>): StaffingConfigPayloadDto {
  return {
    pool: [...THREE_SLOTS],
    bracket: [...THREE_SLOTS],
    finals: [...THREE_SLOTS],
    ...overrides,
  } as StaffingConfigPayloadDto;
}

/** The two lookups `getResolvedConfigForAssignmentBoard` makes before reading rows. */
function queueTournamentContext() {
  fromMock.mockReturnValueOnce(makeChain({ data: { id: 't-1', event_id: 'e-1' }, error: null }));
  fromMock.mockReturnValueOnce(
    makeChain({ data: { id: 'e-1', organization_id: 'org-1' }, error: null }),
  );
}

describe('swiss slot config', () => {
  let service: StaffingService;

  beforeEach(() => {
    vi.resetAllMocks();
    mockOrganizations.assertOrgRole.mockResolvedValue(undefined);
    service = new StaffingService(mockSupabase as never, mockOrganizations as never);
  });

  it('seeds the swiss bucket from pool when the tournament has no swiss rows', async () => {
    // tournament_slot_config rows exist (pool + bracket), so the resolver never
    // reaches the event default or the hard-coded floor.
    queueTournamentContext();
    fromMock.mockReturnValueOnce(
      makeAwaitableChain({
        data: [
          { id: 'sc-1', phase_type: 'pool', slot_index: 1, display_name: 'Déclarant' },
          { id: 'sc-2', phase_type: 'bracket', slot_index: 1, display_name: null },
        ],
        error: null,
      }),
    );
    fromMock.mockReturnValueOnce(
      makeAwaitableChain({
        data: [
          { slot_config_id: 'sc-1', skill_id: 'arbitre_declarant' },
          { slot_config_id: 'sc-2', skill_id: 'arbitre_table' },
        ],
        error: null,
      }),
    );

    const config = await service.getResolvedConfigForAssignmentBoard('t-1');

    expect(config.pool).toEqual([
      { index: 1, displayName: 'Déclarant', allowedSkillIds: ['arbitre_declarant'] },
    ]);
    expect(config.swiss).toEqual(config.pool);
    // A copy, not the same array — mutating one bucket must not move the other.
    expect(config.swiss).not.toBe(config.pool);
    expect(config.bracket).toEqual([
      { index: 1, displayName: null, allowedSkillIds: ['arbitre_table'] },
    ]);
  });

  it('reads persisted swiss rows without crashing, and does not seed over them', async () => {
    // Migration 0164 widened tournament_slot_config's CHECK to accept
    // phase_type='swiss'. Before this slice, grouping such a row pushed onto an
    // undefined bucket and took down every staffing read for that tournament.
    queueTournamentContext();
    fromMock.mockReturnValueOnce(
      makeAwaitableChain({
        data: [
          { id: 'sc-1', phase_type: 'pool', slot_index: 1, display_name: null },
          { id: 'sc-2', phase_type: 'swiss', slot_index: 1, display_name: 'Swiss lead' },
        ],
        error: null,
      }),
    );
    fromMock.mockReturnValueOnce(
      makeAwaitableChain({
        data: [
          { slot_config_id: 'sc-1', skill_id: 'arbitre_declarant' },
          { slot_config_id: 'sc-2', skill_id: 'arbitre_assesseur' },
        ],
        error: null,
      }),
    );

    const config = await service.getResolvedConfigForAssignmentBoard('t-1');

    expect(config.swiss).toEqual([
      { index: 1, displayName: 'Swiss lead', allowedSkillIds: ['arbitre_assesseur'] },
    ]);
    expect(config.pool).toEqual([
      { index: 1, displayName: null, allowedSkillIds: ['arbitre_declarant'] },
    ]);
  });
});

describe('classifyAssignmentsAgainstPayload — swiss', () => {
  it('validates a swiss assignment against the pool slots when swiss is omitted', () => {
    // buildPayload() sends no `swiss` bucket. The resolver seeds swiss from
    // pool, so validation has to use the same slots or a save would silently
    // delete a still-valid Swiss assignment.
    const payload = buildPayload({
      pool: [{ index: 1, displayName: null, allowedSkillIds: ['arbitre_declarant'] }],
    });
    const out = classifyAssignmentsAgainstPayload(
      [
        { id: 'ra-1', pool_id: null, match_id: 'm-1', role: 'arbitre_table' },
        { id: 'ra-2', pool_id: null, match_id: 'm-2', role: 'arbitre_declarant' },
      ],
      payload,
      () => 'swiss',
    );
    expect(out.map((r) => r.id)).toEqual(['ra-1']);
  });

  it('prefers an explicit swiss bucket over the pool seed', () => {
    const payload = buildPayload({
      pool: [{ index: 1, displayName: null, allowedSkillIds: ['arbitre_declarant'] }],
      swiss: [{ index: 1, displayName: null, allowedSkillIds: ['arbitre_table'] }],
    });
    const out = classifyAssignmentsAgainstPayload(
      [
        { id: 'ra-1', pool_id: null, match_id: 'm-1', role: 'arbitre_table' },
        { id: 'ra-2', pool_id: null, match_id: 'm-2', role: 'arbitre_declarant' },
      ],
      payload,
      () => 'swiss',
    );
    expect(out.map((r) => r.id)).toEqual(['ra-2']);
  });
});
