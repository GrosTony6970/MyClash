import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, writesTo, type SupabaseRow } from '../../common/testing/supabase-chain';
import { asSupabase as as, registration } from './swiss.fixtures';
import type { SwissPairingService } from './swiss-pairing.service';
import { SwissSeedingService } from './swiss-seeding.service';
import type { GenerateSwissDto } from './dto/swiss.dto';
import { SwissService } from './swiss.service';

/**
 * Generating a Swiss phase.
 *
 * The seeder is real — the field it loads is what the "at least 2 fighters"
 * guard counts. The pairing service is a stub: committing round 1 is its own
 * path with its own tests, and the seeded double cannot serve a phase row that
 * must be ABSENT before the insert and present after it.
 */
const pairingStub = () => ({
  commitNextRound: vi.fn(async () => ({ roundId: 'sr1', roundNumber: 1 })),
});

const build = (over: Record<string, unknown> = {}) => {
  const supabase = mockSupabase({
    // No Swiss phase yet — that is the state generation starts from. The stamp
    // is what the insert reads back as the new phase's id.
    phases: { rows: [] as SupabaseRow[], returning: { id: 'swiss-new' } },
    registrations: {
      rows: [
        registration('r1'),
        registration('r2'),
        registration('r3'),
        registration('r4'),
        // Another tournament's fighter, and one who withdrew from this one.
        registration('rOther', { tournament_id: 't2' }),
        registration('rGone', { status: 'withdrawn' }),
      ],
    },
    tournaments: { rows: [{ id: 't1', weapon: 'longsword' }] },
    swiss_entrants: { rows: [] as SupabaseRow[] },
    audit_log: { rows: [] as SupabaseRow[] },
    ...over,
  });
  const pairing = pairingStub();
  const service = new SwissService(
    as(supabase),
    pairing as unknown as SwissPairingService,
    new SwissSeedingService(as(supabase)),
  );
  return { supabase, pairing, service };
};

const dto = (over: Partial<GenerateSwissDto> = {}) => over as GenerateSwissDto;

/** The row the phase insert actually wrote. */
const insertedPhase = (supabase: { writes: Parameters<typeof writesTo>[0]['writes'] }) =>
  writesTo(supabase, 'phases')[0]?.row as SupabaseRow;

describe('SwissService.generateSwiss — the phase it writes', () => {
  it('refuses a field too small to pair', async () => {
    const { service, pairing } = build({
      registrations: { rows: [registration('r1')] },
    });

    await expect(service.generateSwiss('t1', dto())).rejects.toBeInstanceOf(BadRequestException);
    expect(pairing.commitNextRound).not.toHaveBeenCalled();
  });

  it('counts only the fighters who are actually registered', async () => {
    // Six rows in the table, four of them this tournament's live entries. A
    // count that included the other two would pair fighters who are not here.
    const { supabase, service } = build();

    const result = await service.generateSwiss('t1', dto());

    expect(result.entrants).toBe(4);
    expect(writesTo(supabase, 'swiss_entrants')[0]?.row).toHaveLength(4);
  });

  it('writes the phase in running order behind pools and ahead of brackets', async () => {
    // Decision 10: pools -> Swiss -> bracket is a valid three-stage
    // tournament, and sort_order is what keeps the three in that order.
    const { supabase, service } = build();

    await service.generateSwiss('t1', dto());

    expect(insertedPhase(supabase)).toMatchObject({
      tournament_id: 't1',
      type: 'swiss',
      sort_order: 2,
      status: 'pending',
    });
  });

  it('enters every seeded fighter, and nobody else', async () => {
    const { supabase, service } = build();

    const result = await service.generateSwiss('t1', dto());

    // Each entrant carries the phase they were entered into: an entrant row
    // with no phase belongs to every Swiss phase in the database at once.
    const entered = writesTo(supabase, 'swiss_entrants')[0]?.row as SupabaseRow[];
    expect(entered.map((row) => row['registration_id']).sort()).toEqual(['r1', 'r2', 'r3', 'r4']);
    expect(entered.every((row) => row['phase_id'] === 'swiss-new')).toBe(true);
    expect(result.phaseId).toBe('swiss-new');
  });

  it('commits round 1 for the phase it just created', async () => {
    const { pairing, service } = build();

    const result = await service.generateSwiss('t1', dto());

    expect(pairing.commitNextRound).toHaveBeenCalledWith('swiss-new');
    expect(result.firstRound).toEqual({ roundId: 'sr1', roundNumber: 1 });
  });

  it('reports a phase insert that persisted nothing', async () => {
    // A silent no-op here would leave the caller believing a phase exists.
    const { service, pairing } = build({
      phases: { rows: [] as SupabaseRow[] },
    });

    await expect(service.generateSwiss('t1', dto())).rejects.toBeInstanceOf(BadRequestException);
    expect(pairing.commitNextRound).not.toHaveBeenCalled();
  });
});

describe('SwissService.generateSwiss — the config it builds', () => {
  it('recommends a round count for the field when none was asked for', async () => {
    const { supabase, service } = build();

    await service.generateSwiss('t1', dto());

    // Four fighters is two rounds by log2, lifted to the floor of three.
    expect(insertedPhase(supabase)['config_json']).toMatchObject({ roundCount: 3 });
  });

  it('keeps the round count the organiser asked for', async () => {
    const { supabase, service } = build();

    const result = await service.generateSwiss('t1', dto({ roundCount: 7 }));

    expect(result.roundCount).toBe(7);
    expect(insertedPhase(supabase)['config_json']).toMatchObject({ roundCount: 7 });
  });

  it('falls back to the documented defaults for everything unset', async () => {
    const { supabase, service } = build();

    await service.generateSwiss('t1', dto());

    expect(insertedPhase(supabase)['config_json']).toMatchObject({
      seedingStrategy: 'random',
      pairingMethod: 'fold',
      grouping: { kind: 'points' },
      rankBy: 'swissPts',
      points: { win: 3, draw: 1, loss: 0, bye: 3 },
      tiebreakChain: ['buchholz', 'sonnebornBerger', 'rulesetChain'],
      minRatingCoveragePercent: null,
      finalized: null,
    });
  });

  it('persists the seed a random draw was made with', async () => {
    // Without it a random draw cannot be replayed, and "the computer shuffled
    // them" is no answer to a fighter who thinks their opponent was chosen.
    const { supabase, service } = build();

    await service.generateSwiss('t1', dto());

    const config = insertedPhase(supabase)['config_json'] as { seedingRandomSeed?: unknown };
    expect(typeof config.seedingRandomSeed).toBe('number');
  });

  it('records the draw against the phase it created', async () => {
    const { supabase, service } = build();

    await service.generateSwiss('t1', dto(), false, '11111111-1111-4111-8111-111111111111');

    expect(writesTo(supabase, 'audit_log')[0]?.row).toMatchObject({
      actor_user_id: '11111111-1111-4111-8111-111111111111',
      action: 'swiss.generate',
      entity_type: 'phase',
      entity_id: 'swiss-new',
    });
  });

  it('records the seed in the audit entry, not only in the config', async () => {
    // The config can be edited afterwards; the audit entry is the copy that
    // still says how round 1 was drawn.
    const { supabase, service } = build();

    await service.generateSwiss('t1', dto());

    const entry = writesTo(supabase, 'audit_log')[0]?.row as SupabaseRow;
    const payload = entry['payload_json'] as {
      seedingRandomSeed?: unknown;
      entrants?: unknown;
      seedingStrategy?: unknown;
    };
    expect(typeof payload.seedingRandomSeed).toBe('number');
    expect(payload).toMatchObject({ entrants: 4, seedingStrategy: 'random' });
  });
});
