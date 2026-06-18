import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgrammeService, decidePoolAffinity } from './programme.service';
import type { SaveProgrammeDto } from './dto/programme.dto';

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock } };

function makeChain(result: unknown) {
  const promise = Promise.resolve(result);
  const chain = Object.assign(promise, {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    gte: vi.fn(),
    lt: vi.fn(),
    order: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
  });

  for (const key of [
    'select',
    'eq',
    'in',
    'gte',
    'lt',
    'order',
    'insert',
    'update',
    'upsert',
    'delete',
  ]) {
    (chain as unknown as Record<string, unknown>)[key] = vi.fn().mockReturnValue(chain);
  }

  return chain;
}

function programmeDto(overrides: Partial<SaveProgrammeDto> = {}): SaveProgrammeDto {
  return {
    blocks: [
      {
        id: 'new-admin',
        dayIndex: 0,
        sortOrder: 0,
        blockType: 'admin',
        label: 'Registration',
        competitionId: null,
        competitionPhase: null,
        workshopId: null,
        liceCount: 0,
        startTime: '08:00',
        endTime: '09:00',
        matchGapSeconds: 0,
        matchDurationMinutes: 0,
      },
      {
        id: 'new-break',
        dayIndex: 0,
        sortOrder: 1,
        blockType: 'break',
        label: 'Break',
        competitionId: null,
        competitionPhase: null,
        workshopId: null,
        liceCount: 0,
        startTime: '09:00',
        endTime: '09:15',
        matchGapSeconds: 0,
        matchDurationMinutes: 0,
      },
      {
        id: 'new-workshop',
        dayIndex: 0,
        sortOrder: 2,
        blockType: 'workshop',
        label: 'Workshop',
        competitionId: null,
        competitionPhase: null,
        workshopId: '00000000-0000-0000-0000-000000000001',
        liceCount: 0,
        startTime: '09:15',
        endTime: '10:15',
        matchGapSeconds: 0,
        matchDurationMinutes: 0,
      },
      {
        id: 'new-competition',
        dayIndex: 0,
        sortOrder: 3,
        blockType: 'competition',
        label: 'Longsword - Pools',
        competitionId: '00000000-0000-0000-0000-000000000002',
        competitionPhase: 'pool',
        workshopId: null,
        liceCount: 2,
        startTime: '10:15',
        endTime: '11:15',
        matchGapSeconds: 15,
        matchDurationMinutes: 5,
      },
    ],
    ...overrides,
  };
}

describe('ProgrammeService', () => {
  let service: ProgrammeService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Drain any queued `mockReturnValueOnce` values from a prior
    // failed/early-exited test — clearAllMocks only resets call
    // history, not the FIFO return queue, so a test that throws
    // before consuming all its mocks would otherwise leak fixtures
    // into the next test in file order.
    fromMock.mockReset();
    service = new ProgrammeService(mockSupabase as never);
  });

  it('strips seconds from start_time / end_time when listing saved blocks', async () => {
    // Postgres column is TIME, which PostgREST serialises as "HH:MM:SS".
    // The FE then PUT-saves that string back, and the DTO regex
    // ^\d{2}:\d{2}$ rejects it → "blocks.0.startTime must match …" 400.
    // The mapper must normalise to HH:MM so the round-trip survives.
    const blockRow = {
      id: 'block-1',
      event_id: 'event-1',
      day_index: 0,
      sort_order: 0,
      block_type: 'admin',
      label: 'Registration',
      competition_id: null,
      competition_phase: null,
      workshop_id: null,
      lice_count: 0,
      start_time: '08:00:00',
      end_time: '09:00:00',
      match_gap_seconds: 0,
      match_duration_minutes: 0,
      generated_at: null,
    };
    fromMock.mockReturnValueOnce(makeChain({ data: [blockRow], error: null }));

    const blocks = await service.listBlocks('event-1');

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.startTime).toBe('08:00');
    expect(blocks[0]!.endTime).toBe('09:00');
  });

  it('saves auto-suggested non-competition blocks with zero match duration', async () => {
    const deleteChain = makeChain({ data: null, error: null });
    const insertChain = makeChain({
      data: [
        {
          id: 'saved-admin',
          event_id: 'event-1',
          day_index: 0,
          sort_order: 0,
          block_type: 'admin',
          label: 'Registration',
          competition_id: null,
          competition_phase: null,
          workshop_id: null,
          lice_count: 0,
          start_time: '08:00',
          end_time: '09:00',
          match_gap_seconds: 0,
          match_duration_minutes: 0,
          generated_at: null,
        },
      ],
      error: null,
    });
    fromMock.mockReturnValueOnce(deleteChain).mockReturnValueOnce(insertChain);

    const saved = await service.saveBlocks('event-1', programmeDto());

    expect(saved).toHaveLength(1);
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          block_type: 'admin',
          match_duration_minutes: 0,
        }),
        expect.objectContaining({
          block_type: 'break',
          match_duration_minutes: 0,
        }),
        expect.objectContaining({
          block_type: 'workshop',
          match_duration_minutes: 0,
        }),
      ]),
    );
  });

  it('creates a single programme block and returns it mapped (next sort_order on the day)', async () => {
    fromMock
      // existing blocks on the day → highest sort_order is 2, so the new one is 3
      .mockReturnValueOnce(makeChain({ data: [{ sort_order: 2 }], error: null }))
      // insert → returns the created row
      .mockReturnValueOnce(
        makeChain({
          data: {
            id: 'blk-new',
            event_id: 'e1',
            day_index: 0,
            sort_order: 3,
            block_type: 'break',
            label: 'Lunch',
            competition_id: null,
            competition_phase: null,
            workshop_id: null,
            lice_count: 0,
            start_time: '12:00:00',
            end_time: '12:30:00',
            match_gap_seconds: 0,
            match_duration_minutes: 0,
            generated_at: null,
          },
          error: null,
        }),
      );

    const { block } = await service.createBlock('e1', {
      dayIndex: 0,
      blockType: 'break',
      label: 'Lunch',
      startTime: '12:00',
      endTime: '12:30',
    } as never);

    expect(block).toMatchObject({
      id: 'blk-new',
      blockType: 'break',
      label: 'Lunch',
      startTime: '12:00',
      endTime: '12:30',
      sortOrder: 3,
    });
  });

  it('round-trips a block color through create', async () => {
    fromMock
      .mockReturnValueOnce(makeChain({ data: [], error: null })) // existing sort_orders
      .mockReturnValueOnce(
        makeChain({
          data: {
            id: 'blk-c',
            event_id: 'e1',
            day_index: 0,
            sort_order: 0,
            block_type: 'break',
            label: 'Coffee',
            competition_id: null,
            competition_phase: null,
            workshop_id: null,
            lice_count: 0,
            start_time: '10:00:00',
            end_time: '10:15:00',
            match_gap_seconds: 0,
            match_duration_minutes: 0,
            color_hex: '#0ea5e9',
            generated_at: null,
          },
          error: null,
        }),
      );

    const { block } = await service.createBlock('e1', {
      dayIndex: 0,
      blockType: 'break',
      label: 'Coffee',
      startTime: '10:00',
      endTime: '10:15',
      colorHex: '#0ea5e9',
    } as never);

    expect(block.colorHex).toBe('#0ea5e9');
  });

  it('resizes a block from the top edge by setting start_time (end fixed)', async () => {
    fromMock
      // load the block
      .mockReturnValueOnce(
        makeChain({
          data: {
            id: 'b1',
            event_id: 'e1',
            day_index: 0,
            sort_order: 0,
            block_type: 'break',
            label: 'Lunch',
            competition_id: null,
            competition_phase: null,
            workshop_id: null,
            lice_count: 0,
            start_time: '12:00:00',
            end_time: '13:00:00',
            match_gap_seconds: 0,
            match_duration_minutes: 0,
            generated_at: null,
          },
          error: null,
        }),
      )
      // update → returns the row with the new start
      .mockReturnValueOnce(
        makeChain({
          data: {
            id: 'b1',
            event_id: 'e1',
            day_index: 0,
            sort_order: 0,
            block_type: 'break',
            label: 'Lunch',
            competition_id: null,
            competition_phase: null,
            workshop_id: null,
            lice_count: 0,
            start_time: '12:15:00',
            end_time: '13:00:00',
            match_gap_seconds: 0,
            match_duration_minutes: 0,
            generated_at: null,
          },
          error: null,
        }),
      );

    const { block } = await service.resizeBlock('e1', 'b1', { newStartTime: '12:15' });
    expect(block).toMatchObject({ startTime: '12:15', endTime: '13:00' });
  });

  it('rejects a top-edge resize that would meet or cross the end', async () => {
    fromMock.mockReturnValueOnce(
      makeChain({
        data: {
          id: 'b1',
          event_id: 'e1',
          day_index: 0,
          sort_order: 0,
          block_type: 'break',
          label: 'Lunch',
          competition_id: null,
          competition_phase: null,
          workshop_id: null,
          lice_count: 0,
          start_time: '12:00:00',
          end_time: '13:00:00',
          match_gap_seconds: 0,
          match_duration_minutes: 0,
          generated_at: null,
        },
        error: null,
      }),
    );

    await expect(service.resizeBlock('e1', 'b1', { newStartTime: '13:00' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('does not suggest workshop blocks (workshops live on their own board)', async () => {
    // buildSuggestion reads lices then tournaments; with no tournaments it
    // builds only admin/break blocks — and never a workshop block.
    fromMock
      .mockReturnValueOnce(makeChain({ data: [{ id: 'l1' }], error: null })) // lices
      .mockReturnValueOnce(makeChain({ data: [], error: null })); // tournaments

    const suggestion = await service.suggest('event-1', {
      dayStartTime: '08:00',
      dayEndTime: '18:00',
      parallelLiceCount: 1,
      matchDurationMinutes: 5,
      matchGapSeconds: 15,
      breakBetweenSessionsMinutes: 10,
      middayBreakStart: '12:00',
      middayBreakEnd: '13:00',
      registrationDurationMinutes: 30,
      gearCheckDurationMinutes: 15,
      refereeMeetingDurationMinutes: 15,
    } as never);

    expect(suggestion.blocks.length).toBeGreaterThan(0);
    expect(suggestion.blocks.some((b) => b.blockType === 'workshop')).toBe(false);
  });

  it('rejects competition blocks with zero match duration before deleting saved blocks', async () => {
    const dto = programmeDto({
      blocks: [
        {
          ...programmeDto().blocks[3]!,
          matchDurationMinutes: 0,
        },
      ],
    });

    await expect(service.saveBlocks('event-1', dto)).rejects.toThrow(BadRequestException);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('generates match schedules from persisted programme blocks', async () => {
    const blockRows = [
      {
        id: 'block-1',
        event_id: 'event-1',
        day_index: 0,
        sort_order: 0,
        block_type: 'competition',
        label: 'Pools',
        competition_id: 'tournament-1',
        competition_phase: 'pool',
        workshop_id: null,
        lice_count: 1,
        start_time: '10:00',
        end_time: '10:30',
        match_gap_seconds: 0,
        match_duration_minutes: 5,
        generated_at: null,
      },
    ];

    fromMock
      .mockReturnValueOnce(makeChain({ data: blockRows, error: null }))
      .mockReturnValueOnce(makeChain({ data: { start_date: '2026-05-21' }, error: null }))
      .mockReturnValueOnce(makeChain({ data: [{ id: 'lice-1', name: 'Lice 1' }], error: null }))
      .mockReturnValueOnce(makeChain({ data: [{ id: 'phase-1', type: 'pool' }], error: null }))
      .mockReturnValueOnce(makeChain({ data: [{ id: 'pool-1' }], error: null }))
      .mockReturnValueOnce(
        makeChain({
          data: [
            {
              id: 'match-1',
              red_registration_id: 'red-1',
              blue_registration_id: 'blue-1',
              pool_id: 'pool-1',
            },
          ],
          error: null,
        }),
      )
      // matches bulk UPSERT — service derives matchesScheduled from
      // the row count returned by .select('id'), not from the
      // scheduler's optimistic intent.
      .mockReturnValueOnce(makeChain({ data: [{ id: 'match-1' }], error: null }))
      .mockReturnValueOnce(makeChain({ data: null, error: null }));

    const result = await service.generate('event-1');

    expect(result.matchesScheduled).toBe(1);
    expect(fromMock).toHaveBeenCalledWith('matches');
  });

  // Generate's matches UPSERT silently swallowed any DB-side rejection
  // before this fix, so a stale "Generated N matches" banner could
  // appear even when zero rows actually persisted. The check matches
  // the existing pattern in the same file at the .resetEventProgramme
  // matches-clear UPDATE (programme.service.ts:147-152).
  it('throws BadRequestException when the matches UPSERT errors', async () => {
    const blockRows = [
      {
        id: 'block-1',
        event_id: 'event-1',
        day_index: 0,
        sort_order: 0,
        block_type: 'competition',
        label: 'Pools',
        competition_id: 'tournament-1',
        competition_phase: 'pool',
        workshop_id: null,
        lice_count: 1,
        start_time: '10:00',
        end_time: '10:30',
        match_gap_seconds: 0,
        match_duration_minutes: 5,
        generated_at: null,
      },
    ];

    fromMock
      .mockReturnValueOnce(makeChain({ data: blockRows, error: null }))
      .mockReturnValueOnce(makeChain({ data: { start_date: '2026-05-21' }, error: null }))
      .mockReturnValueOnce(makeChain({ data: [{ id: 'lice-1', name: 'Lice 1' }], error: null }))
      .mockReturnValueOnce(makeChain({ data: [{ id: 'phase-1', type: 'pool' }], error: null }))
      .mockReturnValueOnce(makeChain({ data: [{ id: 'pool-1' }], error: null }))
      .mockReturnValueOnce(
        makeChain({
          data: [
            {
              id: 'match-1',
              red_registration_id: 'red-1',
              blue_registration_id: 'blue-1',
              pool_id: 'pool-1',
            },
          ],
          error: null,
        }),
      )
      // matches UPSERT — Supabase rejects with an error in the response
      // body. Service must surface it, not silently ignore.
      .mockReturnValueOnce(
        makeChain({ data: null, error: { message: 'mock FK violation on lice_id' } }),
      );

    await expect(service.generate('event-1')).rejects.toThrow(/mock FK violation on lice_id/);
  });

  // ── Bug-fix coverage: missing-matches diagnostics ───────────────────────────

  it('throws a clear error when the event has competition blocks but zero lices', async () => {
    // The operator's symptom: "Generate" succeeds but the grid stays
    // empty. Root cause: `allLices = []` → `blockLices = []` → every
    // competition block silently skipped → matchesScheduled = 0 with
    // no warning. The fix: fail loud so the operator goes to add a
    // lice instead of staring at an empty grid.
    const blockRows = [
      {
        id: 'block-1',
        event_id: 'event-1',
        day_index: 0,
        sort_order: 0,
        block_type: 'competition',
        label: 'Pools',
        competition_id: 'tournament-1',
        competition_phase: 'pool',
        workshop_id: null,
        lice_count: 2,
        start_time: '10:00',
        end_time: '11:00',
        match_gap_seconds: 0,
        match_duration_minutes: 5,
        generated_at: null,
      },
    ];

    fromMock
      .mockReturnValueOnce(makeChain({ data: blockRows, error: null }))
      .mockReturnValueOnce(makeChain({ data: { start_date: '2026-05-21' }, error: null }))
      .mockReturnValueOnce(makeChain({ data: [], error: null })); // ← no lices

    await expect(service.generate('event-1')).rejects.toThrow(/lice/i);
  });

  it('returns per-block diagnostics so the operator can see what each block produced', async () => {
    // Without this the operator only sees a success banner with a
    // total count — they can't tell which block fetched zero matches
    // (a missed draw, an empty pool) or which block ran out of lice
    // capacity. The diagnostics surface that per-block context.
    const blockRows = [
      {
        id: 'block-1',
        event_id: 'event-1',
        day_index: 0,
        sort_order: 0,
        block_type: 'competition',
        label: 'Longsword — Pools',
        competition_id: 'tournament-1',
        competition_phase: 'pool',
        workshop_id: null,
        lice_count: 1,
        start_time: '10:00',
        end_time: '10:30',
        match_gap_seconds: 0,
        match_duration_minutes: 5,
        generated_at: null,
      },
    ];

    fromMock
      .mockReturnValueOnce(makeChain({ data: blockRows, error: null }))
      .mockReturnValueOnce(makeChain({ data: { start_date: '2026-05-21' }, error: null }))
      .mockReturnValueOnce(makeChain({ data: [{ id: 'lice-1', name: 'Lice 1' }], error: null }))
      .mockReturnValueOnce(makeChain({ data: [{ id: 'phase-1', type: 'pool' }], error: null }))
      .mockReturnValueOnce(makeChain({ data: [{ id: 'pool-1' }], error: null }))
      .mockReturnValueOnce(
        makeChain({
          data: [
            {
              id: 'match-1',
              red_registration_id: 'red-1',
              blue_registration_id: 'blue-1',
              pool_id: 'pool-1',
            },
          ],
          error: null,
        }),
      )
      .mockReturnValueOnce(makeChain({ data: [{ id: 'match-1' }], error: null }))
      .mockReturnValueOnce(makeChain({ data: null, error: null }));

    const result = await service.generate('event-1');

    expect(result.blockDiagnostics).toHaveLength(1);
    expect(result.blockDiagnostics![0]).toMatchObject({
      blockId: 'block-1',
      blockLabel: 'Longsword — Pools',
      blockType: 'competition',
      fetchedMatches: 1,
      scheduledMatches: 1,
      licesAvailable: 1,
    });
  });

  // ── Slice 5: drag a fixed block + cascade-shift later matches ──────────────

  describe('moveBlock', () => {
    function buildMoveMocks(opts: {
      block: Record<string, unknown>;
      eventStartDate: string;
      tournamentIds?: string[];
      phaseIds?: string[];
      matches?: Array<{ id: string; scheduled_at: string | null }>;
    }) {
      const tournamentIds = opts.tournamentIds ?? ['tournament-1'];
      const phaseIds = opts.phaseIds ?? ['phase-1'];
      const matches = opts.matches ?? [];
      const updates: Array<{ id: string; scheduled_at: string }> = [];

      const matchesUpdateChain = (() => {
        const result = { data: null, error: null };
        const promise = Promise.resolve(result);
        const chain = Object.assign(promise, {
          select: vi.fn(),
          eq: vi.fn(),
          in: vi.fn(),
          order: vi.fn(),
          insert: vi.fn(),
          update: vi.fn((payload: Record<string, unknown>) => {
            // The service calls eq('id', matchId).update(payload) per
            // match — capture both. We rebuild the chain so .eq() can
            // resolve and complete the call.
            (chain as unknown as Record<string, unknown>)['__pendingUpdate'] = payload;
            return chain;
          }),
          delete: vi.fn(),
          single: vi.fn().mockResolvedValue(result),
        });
        for (const key of ['select', 'in', 'order', 'insert', 'delete']) {
          (chain as unknown as Record<string, unknown>)[key] = vi.fn().mockReturnValue(chain);
        }
        chain.eq = vi.fn((column: string, value: string) => {
          if (column === 'id') {
            const payload = (chain as unknown as Record<string, unknown>)['__pendingUpdate'] as
              | { scheduled_at?: string }
              | undefined;
            if (payload && typeof payload.scheduled_at === 'string') {
              updates.push({ id: value, scheduled_at: payload.scheduled_at });
            }
            (chain as unknown as Record<string, unknown>)['__pendingUpdate'] = undefined;
          }
          return chain;
        });
        return chain;
      })();

      fromMock
        .mockReturnValueOnce(makeChain({ data: opts.block, error: null })) // block fetch
        .mockReturnValueOnce(makeChain({ data: { start_date: opts.eventStartDate }, error: null })) // event fetch
        .mockReturnValueOnce(makeChain({ data: tournamentIds.map((id) => ({ id })), error: null })) // tournaments fetch
        .mockReturnValueOnce(makeChain({ data: phaseIds.map((id) => ({ id })), error: null })) // phases fetch
        .mockReturnValueOnce(makeChain({ data: matches, error: null })); // matches fetch

      // Each match update consumes one fromMock call.
      for (let i = 0; i < matches.length; i++) {
        fromMock.mockReturnValueOnce(matchesUpdateChain);
      }

      // Finally the block update.
      fromMock.mockReturnValueOnce(
        makeChain({
          data: { ...opts.block, start_time: '', end_time: '' },
          error: null,
        }),
      );

      return { updates };
    }

    it('shifts matches scheduled at-or-after the block forward by Δ when the block moves forward', async () => {
      // Event date 2026-06-02. Block was 09:00 → 09:30. Operator drags
      // it to 10:00. Δ = +60 min. Match at 09:15 should shift to 10:15.
      // Match at 08:30 (before the block) stays put.
      const { updates } = buildMoveMocks({
        block: {
          id: 'block-1',
          event_id: 'event-1',
          day_index: 0,
          sort_order: 0,
          block_type: 'admin',
          label: 'Registration',
          competition_id: null,
          competition_phase: null,
          workshop_id: null,
          lice_count: 0,
          start_time: '09:00',
          end_time: '09:30',
          match_gap_seconds: 0,
          match_duration_minutes: 0,
          generated_at: null,
        },
        eventStartDate: '2026-06-02',
        matches: [
          { id: 'match-before', scheduled_at: '2026-06-02T08:30:00.000Z' },
          { id: 'match-after', scheduled_at: '2026-06-02T09:15:00.000Z' },
          { id: 'match-other-day', scheduled_at: '2026-06-03T09:15:00.000Z' },
          { id: 'match-unscheduled', scheduled_at: null },
        ],
      });

      const result = await service.moveBlock('event-1', 'block-1', { newStartTime: '10:00' });

      // Only the at-or-after match on the same day should be shifted.
      expect(updates).toEqual([{ id: 'match-after', scheduled_at: '2026-06-02T10:15:00.000Z' }]);
      expect(result.shiftedMatches).toBe(1);
      expect(result.deltaMinutes).toBe(60);
    });

    it('shifts later matches backward by Δ when the block moves backward', async () => {
      // Block was at 14:00 → 14:30; operator drags it to 13:00. Δ = -60.
      // Match at 14:45 shifts to 13:45. Match at 12:00 stays put.
      const { updates } = buildMoveMocks({
        block: {
          id: 'block-2',
          event_id: 'event-1',
          day_index: 0,
          sort_order: 1,
          block_type: 'break',
          label: 'Break',
          competition_id: null,
          competition_phase: null,
          workshop_id: null,
          lice_count: 0,
          start_time: '14:00',
          end_time: '14:30',
          match_gap_seconds: 0,
          match_duration_minutes: 0,
          generated_at: null,
        },
        eventStartDate: '2026-06-02',
        matches: [
          { id: 'match-before', scheduled_at: '2026-06-02T12:00:00.000Z' },
          { id: 'match-after', scheduled_at: '2026-06-02T14:45:00.000Z' },
        ],
      });

      const result = await service.moveBlock('event-1', 'block-2', { newStartTime: '13:00' });

      expect(updates).toEqual([{ id: 'match-after', scheduled_at: '2026-06-02T13:45:00.000Z' }]);
      expect(result.deltaMinutes).toBe(-60);
    });
  });

  describe('deleteBlock', () => {
    /**
     * Capture the bounds + payload the matches `.update()` call sees so
     * we can assert the right `[startIso, endIso)` window made it
     * through to PostgREST.
     */
    function makeMatchesUpdateChain(updatedRows: Array<{ id: string }>) {
      const captured: {
        payload?: Record<string, unknown>;
        gte?: { column: string; value: string };
        lt?: { column: string; value: string };
        phaseIds?: string[];
      } = {};
      const result = { data: updatedRows, error: null };
      const promise = Promise.resolve(result);
      // Loosely typed chain — Object.assign(promise, {...}) is awkward to
      // type strictly because of the Promise<T> + Record<string, unknown>
      // intersection, and the service only cares that each method
      // returns the chain.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = promise;
      chain.update = vi.fn((payload: Record<string, unknown>) => {
        captured.payload = payload;
        return chain;
      });
      chain.in = vi.fn((column: string, value: string[]) => {
        if (column === 'phase_id') captured.phaseIds = value;
        return chain;
      });
      chain.gte = vi.fn((column: string, value: string) => {
        captured.gte = { column, value };
        return chain;
      });
      chain.lt = vi.fn((column: string, value: string) => {
        captured.lt = { column, value };
        return chain;
      });
      chain.select = vi.fn(() => chain);
      return { chain, captured };
    }

    it('unschedules matches inside the block window and deletes the block', async () => {
      // Block: day 0 (2026-06-02), 10:00 → 11:00 window.
      // Expect: matches.update with scheduled_at=null + lice_id=null,
      // gte=2026-06-02T10:00:00Z, lt=2026-06-02T11:00:00Z,
      // phase_id IN [phase-1], then the block row deletion.
      const blockRow = {
        id: 'block-1',
        event_id: 'event-1',
        day_index: 0,
        start_time: '10:00',
        end_time: '11:00',
      };
      const { chain: matchesChain, captured } = makeMatchesUpdateChain([
        { id: 'match-inside-1' },
        { id: 'match-inside-2' },
      ]);

      fromMock
        .mockReturnValueOnce(makeChain({ data: blockRow, error: null })) // event_programme_blocks select
        .mockReturnValueOnce(makeChain({ data: { start_date: '2026-06-02' }, error: null })) // events select
        .mockReturnValueOnce(makeChain({ data: [{ id: 'tournament-1' }], error: null })) // tournaments select
        .mockReturnValueOnce(makeChain({ data: [{ id: 'phase-1' }], error: null })) // phases select
        .mockReturnValueOnce(matchesChain) // matches update.in.gte.lt.select
        .mockReturnValueOnce(makeChain({ data: null, error: null })); // event_programme_blocks delete

      const result = await service.deleteBlock('event-1', 'block-1');

      expect(captured.payload).toEqual({ scheduled_at: null, lice_id: null });
      expect(captured.phaseIds).toEqual(['phase-1']);
      // Compute the expected ISO bounds via the same wall-clock formula
      // the service uses (container TZ via setHours). Hard-coding
      // `…T10:00:00.000Z` would have a different value on a Paris-TZ
      // runner than on a UTC runner — and would silently pass the
      // earlier bug where setUTCHours mismatched the scheduler's
      // setHours, leaving a 2-hour delete window the operator never
      // asked for.
      const expectedStart = new Date('2026-06-02T00:00:00');
      expectedStart.setHours(10, 0, 0, 0);
      const expectedEnd = new Date('2026-06-02T00:00:00');
      expectedEnd.setHours(11, 0, 0, 0);
      expect(captured.gte).toEqual({
        column: 'scheduled_at',
        value: expectedStart.toISOString(),
      });
      expect(captured.lt).toEqual({
        column: 'scheduled_at',
        value: expectedEnd.toISOString(),
      });
      expect(result).toEqual({
        deletedId: 'block-1',
        unscheduledMatchIds: ['match-inside-1', 'match-inside-2'],
      });
    });

    it("uses the same wall-clock TZ as the scheduler so the [start, end) window matches matches' stored ISOs", async () => {
      // Reproduces the operator-reported bug: deleting a 09:30-10:00
      // block sent matches scheduled at 10:00+ back to unscheduled,
      // because the scheduler stored them at "10:00 local" (08:00 UTC
      // in Paris summer) while the BE used setUTCHours, producing
      // [09:30 UTC, 10:00 UTC) — a window that lands at 11:30-12:00
      // Paris. The runtime check: both ends use setHours (container
      // local) and the test simulates the scheduler's stored ISO via
      // the same formula.
      const blockRow = {
        id: 'block-tz',
        event_id: 'event-tz',
        day_index: 0,
        start_time: '09:30',
        end_time: '10:00',
      };
      const { chain: matchesChain, captured } = makeMatchesUpdateChain([]);
      fromMock
        .mockReturnValueOnce(makeChain({ data: blockRow, error: null }))
        .mockReturnValueOnce(makeChain({ data: { start_date: '2026-06-27' }, error: null }))
        .mockReturnValueOnce(makeChain({ data: [{ id: 'tournament-1' }], error: null }))
        .mockReturnValueOnce(makeChain({ data: [{ id: 'phase-1' }], error: null }))
        .mockReturnValueOnce(matchesChain)
        .mockReturnValueOnce(makeChain({ data: null, error: null }));

      await service.deleteBlock('event-tz', 'block-tz');

      // A match scheduled by the scheduler at "10:00 local" (via
      // setHours, matching grid.tsx slotToTime) — the BE delete must
      // NOT catch it because 10:00 is the exclusive end.
      const matchAtExactEnd = new Date('2026-06-27T00:00:00');
      matchAtExactEnd.setHours(10, 0, 0, 0);
      // A match strictly inside the window (09:45 local) — must be
      // caught.
      const matchInside = new Date('2026-06-27T00:00:00');
      matchInside.setHours(9, 45, 0, 0);

      const gteValue = captured.gte!.value;
      const ltValue = captured.lt!.value;
      expect(matchInside.toISOString() >= gteValue && matchInside.toISOString() < ltValue).toBe(
        true,
      );
      expect(
        matchAtExactEnd.toISOString() >= gteValue && matchAtExactEnd.toISOString() < ltValue,
      ).toBe(false);
    });

    it('still deletes the block when the event has no tournaments', async () => {
      const blockRow = {
        id: 'block-2',
        event_id: 'event-2',
        day_index: 0,
        start_time: '09:00',
        end_time: '09:30',
      };

      fromMock
        .mockReturnValueOnce(makeChain({ data: blockRow, error: null })) // block select
        .mockReturnValueOnce(makeChain({ data: { start_date: '2026-06-02' }, error: null })) // event select
        .mockReturnValueOnce(makeChain({ data: [], error: null })) // tournaments select — empty
        .mockReturnValueOnce(makeChain({ data: null, error: null })); // block delete

      const result = await service.deleteBlock('event-2', 'block-2');

      expect(result).toEqual({ deletedId: 'block-2', unscheduledMatchIds: [] });
    });

    it('throws NotFoundException when the block id does not belong to the event', async () => {
      fromMock.mockReturnValueOnce(makeChain({ data: null, error: null })); // block select returns null

      await expect(service.deleteBlock('event-1', 'missing-block')).rejects.toThrow(
        /not found for event/i,
      );
    });

    it('aborts the block delete when the matches unschedule update fails', async () => {
      const blockRow = {
        id: 'block-3',
        event_id: 'event-3',
        day_index: 0,
        start_time: '12:00',
        end_time: '13:00',
      };
      const failingMatchesChain = makeChain({
        data: null,
        error: { message: 'db went away' },
      });
      const blockDeleteChain = makeChain({ data: null, error: null });

      fromMock
        .mockReturnValueOnce(makeChain({ data: blockRow, error: null }))
        .mockReturnValueOnce(makeChain({ data: { start_date: '2026-06-02' }, error: null }))
        .mockReturnValueOnce(makeChain({ data: [{ id: 'tournament-1' }], error: null }))
        .mockReturnValueOnce(makeChain({ data: [{ id: 'phase-1' }], error: null }))
        .mockReturnValueOnce(failingMatchesChain)
        .mockReturnValueOnce(blockDeleteChain); // would fire if not aborted

      await expect(service.deleteBlock('event-3', 'block-3')).rejects.toThrow(
        /Failed to unschedule matches/i,
      );
      // The block delete chain was never consumed — fromMock should have
      // exactly the queued calls used through the matches step (5 total).
      expect(fromMock).toHaveBeenCalledTimes(5);
    });
  });

  it('emits a "no matches to schedule" warning when a competition block fetches zero matches', async () => {
    // Frequent operator gotcha: they configure a Pools block but
    // haven't run the pool draw yet, so the `matches` table has no
    // rows for that tournament. Today the generator silently `continue`s
    // and the operator sees an empty grid with no clue why.
    const blockRows = [
      {
        id: 'block-empty',
        event_id: 'event-1',
        day_index: 0,
        sort_order: 0,
        block_type: 'competition',
        label: 'Sabre — Pools',
        competition_id: 'tournament-1',
        competition_phase: 'pool',
        workshop_id: null,
        lice_count: 2,
        start_time: '10:00',
        end_time: '11:00',
        match_gap_seconds: 0,
        match_duration_minutes: 5,
        generated_at: null,
      },
    ];

    fromMock
      .mockReturnValueOnce(makeChain({ data: blockRows, error: null }))
      .mockReturnValueOnce(makeChain({ data: { start_date: '2026-05-21' }, error: null }))
      .mockReturnValueOnce(makeChain({ data: [{ id: 'lice-1', name: 'Lice 1' }], error: null }))
      .mockReturnValueOnce(makeChain({ data: [{ id: 'phase-1', type: 'pool' }], error: null }))
      .mockReturnValueOnce(makeChain({ data: [{ id: 'pool-1' }], error: null }))
      .mockReturnValueOnce(makeChain({ data: [], error: null })) // ← zero matches
      .mockReturnValueOnce(makeChain({ data: null, error: null })); // event_programme_blocks update

    const result = await service.generate('event-1');

    expect(result.matchesScheduled).toBe(0);
    expect(result.warnings.some((w) => /no matches/i.test(w.message))).toBe(true);
    expect(result.blockDiagnostics!.find((d) => d.blockId === 'block-empty')).toMatchObject({
      fetchedMatches: 0,
      scheduledMatches: 0,
    });
  });
});

describe('scheduleGroup', () => {
  let svc: ProgrammeService;
  beforeEach(() => {
    fromMock.mockReset();
    svc = new ProgrammeService(mockSupabase as never);
  });

  const START = '2026-05-21T09:00:00.000Z';
  const gm = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    red_registration_id: `r-${id}`,
    blue_registration_id: `b-${id}`,
    pool_id: 'pool-1',
    match_number_label: id,
    phase_id: 'phase-1',
    bracket_slot_id: null,
    ...over,
  });

  it('returns empty without querying for an empty group', async () => {
    const res = await svc.scheduleGroup('event-1', {
      matchIds: [],
      liceIds: ['l1'],
      startTime: START,
      mode: 'pool',
    });
    expect(res.scheduled).toEqual([]);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('rejects matches that are not in the event', async () => {
    fromMock
      .mockReturnValueOnce(makeChain({ data: [{ id: 't1' }], error: null })) // tournaments
      .mockReturnValueOnce(makeChain({ data: [{ id: 'phase-1' }], error: null })) // phases
      .mockReturnValueOnce(makeChain({ data: [gm('m1', { phase_id: 'OTHER' })], error: null })); // matches
    await expect(
      svc.scheduleGroup('event-1', {
        matchIds: ['m1'],
        liceIds: ['l1'],
        startTime: START,
        mode: 'pool',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps a pool group on one lice and persists each match', async () => {
    fromMock
      .mockReturnValueOnce(makeChain({ data: [{ id: 't1' }], error: null })) // tournaments
      .mockReturnValueOnce(makeChain({ data: [{ id: 'phase-1' }], error: null })) // phases
      .mockReturnValueOnce(makeChain({ data: [gm('m1'), gm('m2')], error: null })) // group matches
      .mockReturnValueOnce(
        makeChain({ data: [{ id: 'l1', name: 'L1', sort_order: 0 }], error: null }),
      ) // lices
      .mockReturnValueOnce(makeChain({ data: [], error: null })) // occupants
      .mockReturnValueOnce(makeChain({ data: null, error: null })) // update m1
      .mockReturnValueOnce(makeChain({ data: null, error: null })); // update m2
    const res = await svc.scheduleGroup('event-1', {
      matchIds: ['m1', 'm2'],
      liceIds: ['l1'],
      startTime: START,
      mode: 'pool',
    });
    expect(res.scheduled).toHaveLength(2);
    expect(new Set(res.scheduled.map((s) => s.liceId))).toEqual(new Set(['l1']));
  });

  it('appends after existing occupants via liceBusyUntil', async () => {
    fromMock
      .mockReturnValueOnce(makeChain({ data: [{ id: 't1' }], error: null })) // tournaments
      .mockReturnValueOnce(makeChain({ data: [{ id: 'phase-1' }], error: null })) // phases
      .mockReturnValueOnce(makeChain({ data: [gm('m1')], error: null })) // group matches
      .mockReturnValueOnce(
        makeChain({ data: [{ id: 'l1', name: 'L1', sort_order: 0 }], error: null }),
      ) // lices
      .mockReturnValueOnce(
        makeChain({
          data: [{ id: 'occ', lice_id: 'l1', scheduled_at: '2026-05-21T10:00:00.000Z' }],
          error: null,
        }),
      ) // occupants
      .mockReturnValueOnce(makeChain({ data: null, error: null })); // update m1
    const res = await svc.scheduleGroup('event-1', {
      matchIds: ['m1'],
      liceIds: ['l1'],
      startTime: START,
      mode: 'pool',
    });
    expect(new Date(res.scheduled[0]!.scheduledAt).getTime()).toBeGreaterThanOrEqual(
      new Date('2026-05-21T10:05:00.000Z').getTime(),
    );
  });
});

describe('decidePoolAffinity', () => {
  it('keeps pools strict', () => {
    expect(decidePoolAffinity({ isPool: true, matches: [] })).toBe('strict');
  });

  it('uses bracket-branch for a single-elim bracket with slot coordinates', () => {
    expect(
      decidePoolAffinity({
        isPool: false,
        matches: [
          { bracket_round: 1, bracket_position: 1, phase_type: 'single_elim' },
          { bracket_round: 2, bracket_position: 1, phase_type: 'single_elim' },
        ],
      }),
    ).toBe('bracket-branch');
  });

  it('falls back to greedy for double-elim even with coordinates', () => {
    expect(
      decidePoolAffinity({
        isPool: false,
        matches: [{ bracket_round: 1, bracket_position: 1, phase_type: 'double_elim' }],
      }),
    ).toBe('off');
  });

  it('falls back to greedy when there is no bracket tree', () => {
    expect(
      decidePoolAffinity({
        isPool: false,
        matches: [{ bracket_round: null, bracket_position: null, phase_type: 'single_elim' }],
      }),
    ).toBe('off');
  });

  it('falls back to greedy for an empty match set', () => {
    expect(decidePoolAffinity({ isPool: false, matches: [] })).toBe('off');
  });
});
