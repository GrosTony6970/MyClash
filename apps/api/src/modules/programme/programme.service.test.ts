import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgrammeService, decidePoolAffinity } from './programme.service';
import type { SaveProgrammeDto, SuggestProgrammeDto } from './dto/programme.dto';

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
        minRestMinutes: 0,
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
        minRestMinutes: 0,
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
        minRestMinutes: 0,
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
        minRestMinutes: 10,
      },
    ],
    ...overrides,
  };
}

/** A bracket match row as PostgREST returns it to loadBracketMatches. */
function mkBracketMatch(id: string, label: string, slotId: string) {
  return {
    id,
    red_registration_id: `${id}-red`,
    blue_registration_id: `${id}-blue`,
    pool_id: null,
    match_number_label: label,
    phase_id: 'p1',
    bracket_slot_id: slotId,
  };
}

/** Baseline suggest config with distinct pool / elimination / finals durations. */
function suggestCfg(): SuggestProgrammeDto {
  return {
    dayStartTime: '08:00',
    dayEndTime: '20:00',
    parallelLiceCount: 2,
    poolMatchDurationMinutes: 5,
    eliminationMatchDurationMinutes: 8,
    finalsMatchDurationMinutes: 10,
    matchGapSeconds: 0,
    minRestMinutes: 10,
    breakBetweenSessionsMinutes: 10,
    middayBreakStart: '12:00',
    middayBreakEnd: '13:00',
    registrationDurationMinutes: 30,
    gearCheckDurationMinutes: 15,
    refereeMeetingDurationMinutes: 15,
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
      poolMatchDurationMinutes: 5,
      eliminationMatchDurationMinutes: 8,
      finalsMatchDurationMinutes: 10,
      matchGapSeconds: 15,
      minRestMinutes: 10,
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

  it('carves the final round into a separate Finals block at the finals duration', async () => {
    // A 4-match single-elim: two semis (round 1) + final + bronze (round 2).
    // The final round (gold + bronze) becomes its own 'finals' block at the
    // finals duration; the earlier rounds stay in the 'bracket' block.
    fromMock
      .mockReturnValueOnce(makeChain({ data: [{ id: 'l1' }, { id: 'l2' }], error: null })) // lices
      .mockReturnValueOnce(makeChain({ data: [{ id: 't1', name: 'Longsword' }], error: null })) // tournaments
      .mockReturnValueOnce(makeChain({ data: [{ id: 'p1', type: 'single_elim' }], error: null })) // stats phases
      .mockReturnValueOnce(makeChain({ data: [{ id: 'p1', type: 'single_elim' }], error: null })) // loadBracketMatches phases
      .mockReturnValueOnce(
        makeChain({
          data: [
            mkBracketMatch('m1', 'SF1', 's1'),
            mkBracketMatch('m2', 'SF2', 's2'),
            mkBracketMatch('m3', 'F', 's3'),
            mkBracketMatch('m4', 'BM', 's4'),
          ],
          error: null,
        }),
      ) // bracket matches
      .mockReturnValueOnce(
        makeChain({
          data: [
            { id: 's1', round: 1, position: 1 },
            { id: 's2', round: 1, position: 2 },
            { id: 's3', round: 2, position: 1 },
            { id: 's4', round: 2, position: 2 },
          ],
          error: null,
        }),
      ); // bracket_slots coords

    const suggestion = await service.suggest('event-1', suggestCfg());

    const bracket = suggestion.blocks.find((b) => b.competitionPhase === 'bracket');
    const finals = suggestion.blocks.find((b) => b.competitionPhase === 'finals');
    expect(bracket?.matchDurationMinutes).toBe(8);
    expect(bracket?.label).toBe('Longsword — Bracket');
    expect(finals?.matchDurationMinutes).toBe(10);
    expect(finals?.label).toBe('Longsword — Finals');
  });

  it('emits only a Finals block when the whole bracket is a single final match', async () => {
    fromMock
      .mockReturnValueOnce(makeChain({ data: [{ id: 'l1' }], error: null })) // lices
      .mockReturnValueOnce(makeChain({ data: [{ id: 't1', name: 'Rapier' }], error: null })) // tournaments
      .mockReturnValueOnce(makeChain({ data: [{ id: 'p1', type: 'single_elim' }], error: null })) // stats phases
      .mockReturnValueOnce(makeChain({ data: [{ id: 'p1', type: 'single_elim' }], error: null })) // loadBracketMatches phases
      .mockReturnValueOnce(makeChain({ data: [mkBracketMatch('m1', 'F', 's1')], error: null })) // bracket matches
      .mockReturnValueOnce(makeChain({ data: [{ id: 's1', round: 1, position: 1 }], error: null })); // coords

    const suggestion = await service.suggest('event-1', suggestCfg());

    expect(suggestion.blocks.some((b) => b.competitionPhase === 'bracket')).toBe(false);
    expect(
      suggestion.blocks.find((b) => b.competitionPhase === 'finals')?.matchDurationMinutes,
    ).toBe(10);
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
      .mockReturnValueOnce(makeChain({ data: [], error: null })) // tournament_phase_venues
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
      // realized-window sync: rewrite the competition block's end_time + lice_count
      .mockReturnValueOnce(makeChain({ data: null, error: null }))
      .mockReturnValueOnce(makeChain({ data: null, error: null }));

    const result = await service.generate('event-1');

    expect(result.matchesScheduled).toBe(1);
    expect(fromMock).toHaveBeenCalledWith('matches');
  });

  it('keeps the final round in a lone bracket block when no finals block exists (legacy programme)', async () => {
    // A pre-per-phase-durations programme has a single 'bracket' block covering
    // the whole bracket. Without a sibling 'finals' block the bracket must still
    // schedule the final round (gold + bronze), not drop it as unscheduled.
    const blockRows = [
      {
        id: 'block-1',
        event_id: 'event-1',
        day_index: 0,
        sort_order: 0,
        block_type: 'competition',
        label: 'Bracket',
        competition_id: 'tournament-1',
        competition_phase: 'bracket',
        workshop_id: null,
        lice_count: 2,
        start_time: '10:00',
        end_time: '14:00',
        match_gap_seconds: 0,
        match_duration_minutes: 8,
        generated_at: null,
      },
    ];
    const upsertChain = makeChain({
      data: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }, { id: 'm4' }],
      error: null,
    });

    fromMock
      .mockReturnValueOnce(makeChain({ data: blockRows, error: null })) // blocks
      .mockReturnValueOnce(makeChain({ data: { start_date: '2026-05-21' }, error: null })) // event
      .mockReturnValueOnce(
        makeChain({
          data: [
            { id: 'lice-1', name: 'Lice 1', sort_order: 0, venue_id: null },
            { id: 'lice-2', name: 'Lice 2', sort_order: 1, venue_id: null },
          ],
          error: null,
        }),
      ) // lices
      .mockReturnValueOnce(makeChain({ data: [], error: null })) // tournament_phase_venues
      .mockReturnValueOnce(makeChain({ data: [{ id: 'p1', type: 'single_elim' }], error: null })) // loadBracketMatches phases
      .mockReturnValueOnce(
        makeChain({
          data: [
            mkBracketMatch('m1', 'SF1', 's1'),
            mkBracketMatch('m2', 'SF2', 's2'),
            mkBracketMatch('m3', 'F', 's3'),
            mkBracketMatch('m4', 'BM', 's4'),
          ],
          error: null,
        }),
      ) // bracket matches
      .mockReturnValueOnce(
        makeChain({
          data: [
            { id: 's1', round: 1, position: 1 },
            { id: 's2', round: 1, position: 2 },
            { id: 's3', round: 2, position: 1 },
            { id: 's4', round: 2, position: 2 },
          ],
          error: null,
        }),
      ) // bracket_slots coords
      .mockReturnValueOnce(upsertChain) // matches UPSERT
      .mockReturnValueOnce(makeChain({ data: null, error: null })) // realized-window sync
      .mockReturnValueOnce(makeChain({ data: null, error: null }));

    await service.generate('event-1');

    const upsertArg = upsertChain.upsert.mock.calls[0]?.[0] as Array<{ id: string }>;
    const scheduledIds = upsertArg.map((r) => r.id);
    expect(scheduledIds).toContain('m3'); // gold final
    expect(scheduledIds).toContain('m4'); // bronze
    expect(scheduledIds).toHaveLength(4);
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
      .mockReturnValueOnce(makeChain({ data: [], error: null })) // tournament_phase_venues
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
      .mockReturnValueOnce(makeChain({ data: [], error: null })) // tournament_phase_venues
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
      // realized-window sync: rewrite the competition block's end_time + lice_count
      .mockReturnValueOnce(makeChain({ data: null, error: null }))
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

  it('rewrites the competition block end_time + lice_count from the realized schedule', async () => {
    // The planner estimates 10:00–10:30, but 8 distinct-fighter matches at
    // 5 min each on one lice actually run 40 min → rounds up to a 60-min
    // window (11:00) on a single lice. Generate must sync the block to that.
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
    const matches = Array.from({ length: 8 }, (_, i) => ({
      id: `m${i}`,
      red_registration_id: `r${i}`,
      blue_registration_id: `b${i}`,
      pool_id: 'pool-1',
    }));

    let syncPayload: Record<string, unknown> | null = null;
    const syncChain = (() => {
      const result = { data: null, error: null };
      const promise = Promise.resolve(result);
      const chain = Object.assign(promise, {
        select: vi.fn(),
        eq: vi.fn(),
        in: vi.fn(),
        order: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        upsert: vi.fn(),
        delete: vi.fn(),
        single: vi.fn().mockResolvedValue(result),
      });
      chain.update = vi.fn((p: Record<string, unknown>) => {
        syncPayload = p;
        return chain;
      });
      for (const k of ['select', 'eq', 'in', 'order', 'insert', 'upsert', 'delete']) {
        (chain as unknown as Record<string, unknown>)[k] = vi.fn().mockReturnValue(chain);
      }
      return chain;
    })();

    fromMock
      .mockReturnValueOnce(makeChain({ data: blockRows, error: null }))
      .mockReturnValueOnce(makeChain({ data: { start_date: '2026-05-21' }, error: null }))
      .mockReturnValueOnce(makeChain({ data: [{ id: 'lice-1', name: 'Lice 1' }], error: null }))
      .mockReturnValueOnce(makeChain({ data: [], error: null })) // tournament_phase_venues
      .mockReturnValueOnce(makeChain({ data: [{ id: 'phase-1', type: 'pool' }], error: null }))
      .mockReturnValueOnce(makeChain({ data: [{ id: 'pool-1' }], error: null }))
      .mockReturnValueOnce(makeChain({ data: matches, error: null }))
      .mockReturnValueOnce(makeChain({ data: matches.map((m) => ({ id: m.id })), error: null }))
      .mockReturnValueOnce(syncChain) // realized-window sync update
      .mockReturnValueOnce(makeChain({ data: null, error: null })); // generated_at stamp

    await service.generate('event-1');

    // The block is first on its day, so its start stays 10:00; end + lice_count
    // sync to the realized run. (start_time is now always written by the pack.)
    expect(syncPayload).toEqual({ start_time: '10:00', end_time: '11:00', lice_count: 1 });
  });

  it('clamps a competition block to start after a preceding admin block (no overlap)', async () => {
    // Admin 08:00–10:00 (sort 0) then a pool whose STORED start is a stale
    // 09:00 (sort 1). The sequential pack must push the pool's matches to 10:00
    // — after the admin block — and persist the block's start_time as 10:00.
    const blockRows = [
      {
        id: 'admin-1',
        event_id: 'event-1',
        day_index: 0,
        sort_order: 0,
        block_type: 'admin',
        label: 'Registration & Gear Check',
        competition_id: null,
        competition_phase: null,
        workshop_id: null,
        lice_count: 0,
        start_time: '08:00',
        end_time: '10:00',
        match_gap_seconds: 0,
        match_duration_minutes: 0,
        generated_at: null,
      },
      {
        id: 'pool-block',
        event_id: 'event-1',
        day_index: 0,
        sort_order: 1,
        block_type: 'competition',
        label: 'Longsword — Pools',
        competition_id: 'tournament-1',
        competition_phase: 'pool',
        workshop_id: null,
        lice_count: 1,
        start_time: '09:00',
        end_time: '09:30',
        match_gap_seconds: 0,
        match_duration_minutes: 5,
        generated_at: null,
      },
    ];

    let upsertPayload: Array<Record<string, unknown>> | null = null;
    const upsertChain = makeChain({ data: [{ id: 'match-1' }], error: null });
    upsertChain.upsert = vi.fn((p: Array<Record<string, unknown>>) => {
      upsertPayload = p;
      return upsertChain;
    });
    let syncPayload: Record<string, unknown> | null = null;
    const syncChain = makeChain({ data: null, error: null });
    syncChain.update = vi.fn((p: Record<string, unknown>) => {
      syncPayload = p;
      return syncChain;
    });

    fromMock
      .mockReturnValueOnce(makeChain({ data: blockRows, error: null })) // blocks
      .mockReturnValueOnce(makeChain({ data: { start_date: '2026-05-21' }, error: null })) // event
      .mockReturnValueOnce(makeChain({ data: [{ id: 'lice-1', name: 'Lice 1' }], error: null })) // lices
      .mockReturnValueOnce(makeChain({ data: [], error: null })) // tournament_phase_venues
      // admin block is first + unshifted → no DB write; then the pool block:
      .mockReturnValueOnce(makeChain({ data: [{ id: 'phase-1', type: 'pool' }], error: null })) // phases
      .mockReturnValueOnce(makeChain({ data: [{ id: 'pool-1' }], error: null })) // pools
      .mockReturnValueOnce(
        makeChain({
          data: [
            {
              id: 'match-1',
              red_registration_id: 'r1',
              blue_registration_id: 'b1',
              pool_id: 'pool-1',
            },
          ],
          error: null,
        }),
      ) // matches select
      .mockReturnValueOnce(upsertChain) // matches upsert
      .mockReturnValueOnce(syncChain) // competition block sync update
      .mockReturnValueOnce(makeChain({ data: null, error: null })); // generated_at stamp

    await service.generate('event-1');

    // Block start clamped to 10:00 (after admin), not its stale 09:00.
    expect(syncPayload).toMatchObject({ start_time: '10:00' });
    // The match itself lands at 10:00 wall-clock (compute via the same
    // setHours formula the scheduler uses, so this holds on any runner TZ).
    const expectedStart = new Date('2026-05-21T00:00:00');
    expectedStart.setHours(10, 0, 0, 0);
    expect(upsertPayload).not.toBeNull();
    expect(upsertPayload![0]!['scheduled_at']).toBe(expectedStart.toISOString());
  });

  it('cascades a later break after a competition run that overflows its slot', async () => {
    // A pool that actually runs 09:00–12:30 (7×30 min on one lice) must push a
    // Lunch break stored at 12:00–13:00 down to 12:30–13:30 — no overlap. This
    // covers the case the old break-only shift handled, now via the unified pack.
    const blockRows = [
      {
        id: 'pool-block',
        event_id: 'event-1',
        day_index: 0,
        sort_order: 0,
        block_type: 'competition',
        label: 'Longsword — Pools',
        competition_id: 'tournament-1',
        competition_phase: 'pool',
        workshop_id: null,
        lice_count: 1,
        start_time: '09:00',
        end_time: '09:30',
        match_gap_seconds: 0,
        match_duration_minutes: 30,
        generated_at: null,
      },
      {
        id: 'lunch',
        event_id: 'event-1',
        day_index: 0,
        sort_order: 1,
        block_type: 'break',
        label: 'Lunch',
        competition_id: null,
        competition_phase: null,
        workshop_id: null,
        lice_count: 0,
        start_time: '12:00',
        end_time: '13:00',
        match_gap_seconds: 0,
        match_duration_minutes: 0,
        generated_at: null,
      },
    ];
    const matches = Array.from({ length: 7 }, (_, i) => ({
      id: `m${i}`,
      red_registration_id: `r${i}`,
      blue_registration_id: `b${i}`,
      pool_id: 'pool-1',
    }));

    let breakPayload: Record<string, unknown> | null = null;
    const breakChain = makeChain({ data: null, error: null });
    breakChain.update = vi.fn((p: Record<string, unknown>) => {
      breakPayload = p;
      return breakChain;
    });

    fromMock
      .mockReturnValueOnce(makeChain({ data: blockRows, error: null })) // blocks
      .mockReturnValueOnce(makeChain({ data: { start_date: '2026-05-21' }, error: null })) // event
      .mockReturnValueOnce(makeChain({ data: [{ id: 'lice-1', name: 'Lice 1' }], error: null })) // lices
      .mockReturnValueOnce(makeChain({ data: [], error: null })) // tournament_phase_venues
      .mockReturnValueOnce(makeChain({ data: [{ id: 'phase-1', type: 'pool' }], error: null })) // phases
      .mockReturnValueOnce(makeChain({ data: [{ id: 'pool-1' }], error: null })) // pools
      .mockReturnValueOnce(makeChain({ data: matches, error: null })) // matches select
      .mockReturnValueOnce(makeChain({ data: matches.map((m) => ({ id: m.id })), error: null })) // upsert
      .mockReturnValueOnce(makeChain({ data: null, error: null })) // competition sync update
      .mockReturnValueOnce(breakChain) // break shift update
      .mockReturnValueOnce(makeChain({ data: null, error: null })); // generated_at stamp

    await service.generate('event-1');

    expect(breakPayload).toEqual({ start_time: '12:30', end_time: '13:30' });
  });

  it('leaves already-sequential blocks untouched (idempotent; preserves gaps)', async () => {
    // Admin 08:00–09:00 then a break at 10:00–10:30 (an intentional 1 h gap).
    // Neither overlaps, so the pack shifts nothing — only generated_at writes.
    // Re-running Generate Grid on a clean layout is a no-op.
    const blockRows = [
      {
        id: 'admin-1',
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
      {
        id: 'coffee',
        event_id: 'event-1',
        day_index: 0,
        sort_order: 1,
        block_type: 'break',
        label: 'Coffee',
        competition_id: null,
        competition_phase: null,
        workshop_id: null,
        lice_count: 0,
        start_time: '10:00',
        end_time: '10:30',
        match_gap_seconds: 0,
        match_duration_minutes: 0,
        generated_at: null,
      },
    ];

    fromMock
      .mockReturnValueOnce(makeChain({ data: blockRows, error: null })) // blocks
      .mockReturnValueOnce(makeChain({ data: { start_date: '2026-05-21' }, error: null })) // event
      .mockReturnValueOnce(makeChain({ data: [{ id: 'lice-1', name: 'Lice 1' }], error: null })) // lices
      .mockReturnValueOnce(makeChain({ data: null, error: null })); // generated_at stamp

    const result = await service.generate('event-1');

    expect(result.matchesScheduled).toBe(0);
    // blocks + event + lices + stamp = 4; no per-block shift writes.
    expect(fromMock).toHaveBeenCalledTimes(4);
  });

  // ── Slice 5: drag a fixed block + cascade-shift later matches ──────────────

  describe('moveBlock', () => {
    /**
     * A `scheduled_at` for a WALL-CLOCK time on the event's day.
     *
     * These fixtures used to be hard-coded `...Z` strings, which quietly
     * asserted UTC semantics and passed only because CI runs in UTC. The
     * scheduler stores matches with `setHours` (container-local `TZ`), and
     * moveBlock now reads them back the same way — so on a UTC+1 container a
     * match written "08:30Z" is 09:30 local and genuinely IS after a 09:00
     * block. Constructing the fixture from local parts makes each test mean
     * the same thing on every machine, which is the property that was missing
     * when moveBlock silently shifted nothing in production.
     */
    const at = (y: number, m: number, d: number, hh: number, mm: number): string =>
      new Date(y, m - 1, d, hh, mm, 0, 0).toISOString();

    function buildMoveMocks(opts: {
      block: Record<string, unknown>;
      eventStartDate: string;
      tournamentIds?: string[];
      phaseIds?: string[];
      matches?: Array<{ id: string; scheduled_at: string | null }>;
      /** Make every per-match shift UPDATE fail, to test the count's honesty. */
      updateError?: { message: string };
    }) {
      const tournamentIds = opts.tournamentIds ?? ['tournament-1'];
      const phaseIds = opts.phaseIds ?? ['phase-1'];
      const matches = opts.matches ?? [];
      const updates: Array<{ id: string; scheduled_at: string }> = [];

      const matchesUpdateChain = (() => {
        const result = { data: null, error: opts.updateError ?? null };
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
              { scheduled_at?: string } | undefined;
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
          { id: 'match-before', scheduled_at: at(2026, 6, 2, 8, 30) },
          { id: 'match-after', scheduled_at: at(2026, 6, 2, 9, 15) },
          { id: 'match-other-day', scheduled_at: at(2026, 6, 3, 9, 15) },
          { id: 'match-unscheduled', scheduled_at: null },
        ],
      });

      const result = await service.moveBlock('event-1', 'block-1', { newStartTime: '10:00' });

      // Only the at-or-after match on the same day should be shifted.
      expect(updates).toEqual([{ id: 'match-after', scheduled_at: at(2026, 6, 2, 10, 15) }]);
      expect(result.shiftedMatches).toBe(1);
      expect(result.deltaMinutes).toBe(60);
    });

    /**
     * `shiftedMatches` is what the operator is told moved. The loop used to
     * increment it without reading `error`, so a refused UPDATE still counted
     * — a partly-cascaded day reported as a complete one, and the grid's
     * refetch then disagreed with the number it had just been given.
     */
    it('does not count a match it failed to shift', async () => {
      buildMoveMocks({
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
        matches: [{ id: 'match-after', scheduled_at: at(2026, 6, 2, 9, 15) }],
        updateError: { message: 'deadlock detected' },
      });

      await expect(
        service.moveBlock('event-1', 'block-1', { newStartTime: '10:00' }),
      ).rejects.toThrow(/Failed to shift match match-after: deadlock detected/);
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
          { id: 'match-before', scheduled_at: at(2026, 6, 2, 12, 0) },
          { id: 'match-after', scheduled_at: at(2026, 6, 2, 14, 45) },
        ],
      });

      const result = await service.moveBlock('event-1', 'block-2', { newStartTime: '13:00' });

      expect(updates).toEqual([{ id: 'match-after', scheduled_at: at(2026, 6, 2, 13, 45) }]);
      expect(result.deltaMinutes).toBe(-60);
    });

    /**
     * THE REGRESSION. moveBlock used to compare `getUTCHours()` against a block
     * time that the scheduler had written with `setHours`. On any container
     * whose TZ is not UTC the two disagree by the offset, and east of Greenwich
     * the comparison fails low: a 09:00 block is stored 08:00Z, `480 < 540`,
     * and EVERY match is skipped. The bar moved; nothing followed it; nothing
     * threw. `20-schedule.spec.ts` caught it against the real deployment.
     *
     * The fixture is a match at the block's exact start — the boundary the old
     * code got wrong — expressed in wall-clock terms, so this test fails on the
     * UTC implementation on any non-UTC machine and passes on the fixed one
     * everywhere.
     */
    it('shifts a match sitting exactly on the block start, whatever the container TZ', async () => {
      const { updates } = buildMoveMocks({
        block: {
          id: 'block-tz',
          event_id: 'event-1',
          day_index: 0,
          sort_order: 0,
          block_type: 'competition',
          label: 'Pools',
          competition_id: null,
          competition_phase: null,
          workshop_id: null,
          lice_count: 2,
          start_time: '09:00',
          end_time: '18:00',
          match_gap_seconds: 0,
          match_duration_minutes: 5,
          generated_at: null,
        },
        eventStartDate: '2099-03-01',
        // Both sides of the boundary. The earlier match also leaves `buildMoveMocks`
        // a spare update chain — it queues one per match, and the day-blocks
        // query consumes whatever is next, so a fixture where EVERY match
        // shifts starves it and fails on the wrong assertion entirely.
        matches: [
          { id: 'match-before-start', scheduled_at: at(2099, 3, 1, 8, 30) },
          { id: 'match-at-start', scheduled_at: at(2099, 3, 1, 9, 0) },
        ],
      });

      const result = await service.moveBlock('event-1', 'block-tz', { newStartTime: '10:00' });

      expect(updates).toEqual([{ id: 'match-at-start', scheduled_at: at(2099, 3, 1, 10, 0) }]);
      expect(result.shiftedMatches).toBe(1);
    });

    it('cascades following same-day blocks by Δ (the moved block included)', async () => {
      const movedBlock = {
        id: 'moved',
        event_id: 'event-1',
        day_index: 0,
        sort_order: 1,
        block_type: 'admin',
        label: 'Referee Meeting',
        competition_id: null,
        competition_phase: null,
        workshop_id: null,
        lice_count: 0,
        start_time: '09:00',
        end_time: '09:30',
        match_gap_seconds: 0,
        match_duration_minutes: 0,
        generated_at: null,
      };
      const blockUpdates: Array<{ id: string; payload: Record<string, unknown> }> = [];
      function recChain() {
        let pending: Record<string, unknown> | undefined;
        const result = {
          data: { ...movedBlock, start_time: '10:00', end_time: '10:30' },
          error: null,
        };
        const promise = Promise.resolve(result);
        const chain = Object.assign(promise, {
          select: vi.fn(),
          eq: vi.fn(),
          in: vi.fn(),
          order: vi.fn(),
          insert: vi.fn(),
          update: vi.fn(),
          upsert: vi.fn(),
          delete: vi.fn(),
          single: vi.fn().mockResolvedValue(result),
        });
        chain.update = vi.fn((p: Record<string, unknown>) => {
          pending = p;
          return chain;
        });
        chain.eq = vi.fn((col: string, val: string) => {
          if (col === 'id' && pending) blockUpdates.push({ id: val, payload: pending });
          return chain;
        });
        for (const k of ['select', 'in', 'order', 'insert', 'upsert', 'delete']) {
          (chain as unknown as Record<string, unknown>)[k] = vi.fn().mockReturnValue(chain);
        }
        return chain;
      }

      fromMock
        .mockReturnValueOnce(makeChain({ data: movedBlock, error: null })) // block fetch
        .mockReturnValueOnce(makeChain({ data: { start_date: '2026-06-02' }, error: null })) // event
        .mockReturnValueOnce(makeChain({ data: [], error: null })) // tournaments → skip match shift
        .mockReturnValueOnce(
          makeChain({
            data: [
              { id: 'reg', start_time: '08:00:00', end_time: '09:00:00' },
              { id: 'moved', start_time: '09:00:00', end_time: '09:30:00' },
              { id: 'pool', start_time: '09:30:00', end_time: '12:00:00' },
            ],
            error: null,
          }),
        ) // day-blocks fetch
        .mockReturnValueOnce(recChain()) // update moved
        .mockReturnValueOnce(recChain()); // update pool

      const result = await service.moveBlock('event-1', 'moved', { newStartTime: '10:00' });

      expect(result.deltaMinutes).toBe(60);
      // moved (09:00→10:00) and pool (09:30→10:30) shift +60; reg (08:00) stays.
      expect(blockUpdates).toEqual([
        { id: 'moved', payload: { start_time: '10:00', end_time: '10:30' } },
        { id: 'pool', payload: { start_time: '10:30', end_time: '13:00' } },
      ]);
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
      .mockReturnValueOnce(makeChain({ data: [], error: null })) // tournament_phase_venues
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

  it('uses branch grouping for double-elim too', () => {
    // Double-elim spreads its WINNERS bracket across lices and converges the
    // losers bracket (which consumes WB losers, so it cannot run in parallel).
    // It used to fall back to greedy, which ignored the tree entirely.
    expect(
      decidePoolAffinity({
        isPool: false,
        matches: [{ bracket_round: 1, bracket_position: 1, phase_type: 'double_elim' }],
      }),
    ).toBe('bracket-branch');
  });

  it('falls back to greedy for a non-bracket phase type', () => {
    expect(
      decidePoolAffinity({
        isPool: false,
        matches: [{ bracket_round: 1, bracket_position: 1, phase_type: 'swiss' }],
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
