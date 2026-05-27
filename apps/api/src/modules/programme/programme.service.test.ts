import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgrammeService } from './programme.service';
import type { SaveProgrammeDto } from './dto/programme.dto';

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock } };

function makeChain(result: unknown) {
  const promise = Promise.resolve(result);
  const chain = Object.assign(promise, {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    single: vi.fn().mockResolvedValue(result),
  });

  for (const key of ['select', 'eq', 'in', 'order', 'insert', 'update', 'delete']) {
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
            },
          ],
          error: null,
        }),
      )
      .mockReturnValueOnce(makeChain({ data: null, error: null }))
      .mockReturnValueOnce(makeChain({ data: null, error: null }));

    const result = await service.generate('event-1');

    expect(result.matchesScheduled).toBe(1);
    expect(fromMock).toHaveBeenCalledWith('matches');
  });
});
