import { describe, expect, it, vi } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  queriedTables,
  selectsFor,
  writesTo,
} from '../../common/testing/supabase-chain';
import { PROGRAMME_CONFIG_DEFAULTS, type SaveProgrammeDto } from './dto/programme.dto';
import { ProgrammeService } from './programme.service';

/**
 * A programme bar and a sheet row name a Tournament or a Workshop by id, and
 * nothing in the database ties that id to the bar's Event
 * (`event_programme_blocks.competition_id` references `tournaments(id)` alone,
 * migration 0028). Generate reads a bar's Tournament's bouts by id alone, so
 * another Event's id there made it read that Event's bouts and fail partway
 * through on migration 0197, after earlier bars' bouts were written. Each door
 * refuses one before it writes anything.
 */

const EVENT = 'event-1';
const CALLER = 'user-1';
const OWN_TOURNAMENT = '11111111-1111-4111-8111-111111111111';
const FOREIGN_TOURNAMENT = '22222222-2222-4222-8222-222222222222';
const OWN_WORKSHOP = '33333333-3333-4333-8333-333333333333';
const FOREIGN_WORKSHOP = '44444444-4444-4444-8444-444444444444';

type Bar = SaveProgrammeDto['blocks'][number];

/** A Tournament and a Workshop of this Event, one of each of another, and the programme's own tables. */
function seeded() {
  return mockSupabase({
    tournaments: {
      rows: [
        { id: OWN_TOURNAMENT, event_id: EVENT },
        { id: FOREIGN_TOURNAMENT, event_id: 'event-2' },
      ],
    },
    workshops: {
      rows: [
        { id: OWN_WORKSHOP, event_id: EVENT },
        { id: FOREIGN_WORKSHOP, event_id: 'event-2' },
      ],
    },
    // createBlock reads the day's sort orders, then inserts and reads the bar back.
    event_programme_blocks: [
      { data: [], error: null },
      { data: { id: 'bar-new', event_id: EVENT, start_time: '09:00', end_time: '10:00' } },
    ],
    event_programme_configs: { data: { config_json: PROGRAMME_CONFIG_DEFAULTS }, error: null },
  });
}

/** The service, with the org-role check stubbed: authorization has its own suite. */
function programme(supabase: ReturnType<typeof seeded>): ProgrammeService {
  const service = new ProgrammeService(supabase as never, {} as never);
  vi.spyOn(
    service as never as { assertWriter: () => Promise<void> },
    'assertWriter',
  ).mockResolvedValue(undefined);
  return service;
}

const competitionBar = (competitionId: string, id = 'bar-1'): Bar => ({
  id,
  dayIndex: 0,
  sortOrder: 0,
  blockType: 'competition',
  label: 'Pools',
  competitionId,
  competitionPhase: 'pool',
  workshopId: null,
  liceCount: 1,
  startTime: '09:00',
  endTime: '10:00',
});

const workshopBar = (workshopId: string): Bar => ({
  ...competitionBar(OWN_TOURNAMENT, 'bar-w'),
  blockType: 'workshop',
  label: 'Drills',
  competitionId: null,
  competitionPhase: null,
  workshopId,
  liceCount: 0,
});

describe('saveBlocks', () => {
  it("refuses another Event's Tournament before writing any bar", async () => {
    const supabase = seeded();
    const bars = [competitionBar(OWN_TOURNAMENT), competitionBar(FOREIGN_TOURNAMENT, 'bar-2')];

    await expect(programme(supabase).saveBlocks(EVENT, { blocks: bars }, CALLER)).rejects.toThrow(
      'Every Tournament must belong to this event',
    );

    expect(writesTo(supabase, 'event_programme_blocks')).toEqual([]);
    expect(selectsFor(supabase.from, 'tournaments')).toEqual(['id']);
    expect(filtersFor(supabase.from, 'tournaments', 'eq')).toEqual([['event_id', EVENT]]);
    expect(filtersFor(supabase.from, 'tournaments', 'in')).toEqual([
      ['id', [OWN_TOURNAMENT, FOREIGN_TOURNAMENT]],
    ]);
  });

  it("refuses another Event's Workshop before writing any bar", async () => {
    const supabase = seeded();
    const bars = [competitionBar(OWN_TOURNAMENT), workshopBar(FOREIGN_WORKSHOP)];

    await expect(programme(supabase).saveBlocks(EVENT, { blocks: bars }, CALLER)).rejects.toThrow(
      'Every Workshop must belong to this event',
    );

    expect(writesTo(supabase, 'event_programme_blocks')).toEqual([]);
    expect(selectsFor(supabase.from, 'workshops')).toEqual(['id']);
    expect(filtersFor(supabase.from, 'workshops', 'eq')).toEqual([['event_id', EVENT]]);
    expect(filtersFor(supabase.from, 'workshops', 'in')).toEqual([['id', [FOREIGN_WORKSHOP]]]);
  });

  it("writes bars that name the Event's own Tournament and Workshop", async () => {
    const supabase = seeded();
    const bars = [competitionBar(OWN_TOURNAMENT), workshopBar(OWN_WORKSHOP)];

    await programme(supabase).saveBlocks(EVENT, { blocks: bars }, CALLER);

    const [upsert] = writesTo(supabase, 'event_programme_blocks');
    expect(upsert?.op).toBe('upsert');
    expect(upsert?.row).toEqual([
      expect.objectContaining({ competition_id: OWN_TOURNAMENT, workshop_id: null }),
      expect.objectContaining({ competition_id: null, workshop_id: OWN_WORKSHOP }),
    ]);
  });
});

describe('createBlock', () => {
  it("refuses another Event's Tournament before reading or writing the day", async () => {
    const supabase = seeded();
    const dto = { ...competitionBar(FOREIGN_TOURNAMENT), sortOrder: undefined };

    await expect(programme(supabase).createBlock(EVENT, dto as never, CALLER)).rejects.toThrow(
      'Every Tournament must belong to this event',
    );

    expect(queriedTables(supabase.from)).toEqual(['tournaments']);
    expect(writesTo(supabase, 'event_programme_blocks')).toEqual([]);
    expect(selectsFor(supabase.from, 'tournaments')).toEqual(['id']);
    expect(filtersFor(supabase.from, 'tournaments', 'eq')).toEqual([['event_id', EVENT]]);
    expect(filtersFor(supabase.from, 'tournaments', 'in')).toEqual([['id', [FOREIGN_TOURNAMENT]]]);
  });

  it("writes a bar that names the Event's own Workshop", async () => {
    const supabase = seeded();

    await programme(supabase).createBlock(EVENT, workshopBar(OWN_WORKSHOP) as never, CALLER);

    const [insert] = writesTo(supabase, 'event_programme_blocks');
    expect(insert?.op).toBe('insert');
    expect(insert?.row).toMatchObject({ event_id: EVENT, workshop_id: OWN_WORKSHOP });
    expect(filtersFor(supabase.from, 'workshops', 'in')).toEqual([['id', [OWN_WORKSHOP]]]);
  });
});

describe('putConfig', () => {
  const sheetNaming = (tournamentId: string) => ({
    ...PROGRAMME_CONFIG_DEFAULTS,
    tournaments: [{ tournamentId, poolMatchDurationMinutes: 7 }],
  });

  it("refuses a row of lengths for another Event's Tournament before storing the sheet", async () => {
    const supabase = seeded();

    await expect(
      programme(supabase).putConfig(EVENT, sheetNaming(FOREIGN_TOURNAMENT), CALLER),
    ).rejects.toThrow('Every Tournament must belong to this event');

    expect(writesTo(supabase, 'event_programme_configs')).toEqual([]);
    expect(selectsFor(supabase.from, 'tournaments')).toEqual(['id']);
    expect(filtersFor(supabase.from, 'tournaments', 'eq')).toEqual([['event_id', EVENT]]);
    expect(filtersFor(supabase.from, 'tournaments', 'in')).toEqual([['id', [FOREIGN_TOURNAMENT]]]);
  });

  it("stores a row of lengths for the Event's own Tournament", async () => {
    const supabase = seeded();

    await programme(supabase).putConfig(EVENT, sheetNaming(OWN_TOURNAMENT), CALLER);

    const [upsert] = writesTo(supabase, 'event_programme_configs');
    expect(upsert?.op).toBe('upsert');
    expect(upsert?.row).toMatchObject({
      event_id: EVENT,
      config_json: sheetNaming(OWN_TOURNAMENT),
    });
  });
});
