import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClockService } from './clock.service';

/**
 * Taking a LEVEL bout one step down its phase's chain of remedies.
 *
 * `end` refuses a level bout and NAMES what it is waiting on; this is the route
 * where the referee says they have played it. Its own file rather than
 * `clock-end-result.test.ts` because the read/write queue is a different one:
 *   matches → match_events (replay) → match_events (next sequence)
 *   → match_events (insert) → [adjust_time, for extra time only]
 *   → match_events (replay again)
 */
function thenable(data: unknown) {
  const result = { data, error: null };
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'insert', 'update']) {
    chain[m] = vi.fn(() => chain);
  }
  chain['maybeSingle'] = vi.fn().mockResolvedValue(result);
  (chain as { then?: unknown })['then'] = (resolve: (v: unknown) => unknown) => resolve(result);
  return chain;
}

/** A running bout with 90s of the phase's 90s limit already spent — 00:00. */
const SPENT = [
  { id: 'e1', type: 'start', reason: null, occurred_at: '2026-04-25T09:00:00.000Z' },
  { id: 'e2', type: 'halt', reason: null, occurred_at: '2026-04-25T09:01:30.000Z' },
];

/** The same bout 30s in — a minute of the 90s still to fight. */
const EARLY = [
  { id: 'e1', type: 'start', reason: null, occurred_at: '2026-04-25T09:00:00.000Z' },
  { id: 'e2', type: 'halt', reason: null, occurred_at: '2026-04-25T09:00:30.000Z' },
];

const step = (id: string) => ({
  id,
  type: 'level_resolution',
  reason: null,
  occurred_at: '2026-04-25T09:02:00.000Z',
});

function levelBracket(over: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    status: 'running',
    locked_at: null,
    red_registration_id: 'red',
    blue_registration_id: 'blue',
    winner_registration_id: null,
    red_score: 2,
    blue_score: 2,
    match_number_label: 'QF1',
    phases: { type: 'single_elim', tournaments: { ruleset_config: {} } },
    ...over,
  };
}

describe('ClockService.advanceLevelResolution', () => {
  const fromMock = vi.fn();
  const supabase = { service: { from: fromMock } };
  let service: ClockService;
  let inserted: Array<Record<string, unknown>>;
  let matchProjection: string;

  function wire(match: Record<string, unknown> | null, events: unknown[] = SPENT) {
    fromMock.mockReset();
    inserted = [];
    matchProjection = '';
    const matchChain = thenable(match);
    (matchChain['select'] as ReturnType<typeof vi.fn>).mockImplementation((cols: string) => {
      // FIRST only: `adjustTime` reads `matches` again for its own lock check,
      // with a two-column projection that would otherwise overwrite this.
      if (!matchProjection) matchProjection = cols;
      return matchChain;
    });
    const capture = (data: unknown) => {
      const chain = thenable(data);
      (chain['insert'] as ReturnType<typeof vi.fn>).mockImplementation(
        (row: Record<string, unknown>) => {
          inserted.push(row);
          return chain;
        },
      );
      return chain;
    };
    fromMock.mockImplementation((table: string) => {
      if (table === 'matches') return matchChain;
      // Every `match_events` read answers with the timeline; the sequence read
      // takes `.maybeSingle()` off the same array, which is null-safe here
      // because the insert path only needs `sequence ?? 0`.
      return capture(events);
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ClockService(supabase as never);
  });

  it('applies extra time, recording the step and putting the seconds back', async () => {
    wire(levelBracket());

    const result = await service.advanceLevelResolution('m1');

    expect(result.applied).toEqual({ kind: 'extra_time', seconds: 60 });
    const levelRows = inserted.filter((r) => r['type'] === 'level_resolution');
    expect(levelRows).toHaveLength(1);
    // NEGATIVE: `adjust_time` mutates elapsed, and a countdown shows
    // `limit − elapsed`. 90s spent of a 90s limit, plus 60s of extra time,
    // means 30s elapsed — an adjustment of −60s.
    const adjust = inserted.find((r) => r['type'] === 'adjust_time');
    expect(adjust?.['adjustment_ms']).toBe(-60_000);
  });

  it('applies sudden death without touching the clock', async () => {
    // There is no per-match limit to lift: the countdown simply sits at 00:00
    // and the pad shows a skull with a count-up instead of a numeral.
    wire(levelBracket(), [...SPENT, step('lr1')]);

    const result = await service.advanceLevelResolution('m1');

    expect(result.applied).toEqual({ kind: 'sudden_death' });
    expect(inserted.filter((r) => r['type'] === 'level_resolution')).toHaveLength(1);
    expect(inserted.some((r) => r['type'] === 'adjust_time')).toBe(false);
  });

  it('refuses once the chain is spent', async () => {
    wire(levelBracket(), [...SPENT, step('lr1'), step('lr2')]);

    await expect(service.advanceLevelResolution('m1')).rejects.toThrow(/No further remedy/);
    expect(inserted).toEqual([]);
  });

  it('refuses a POOL bout, whose chain is a draw', async () => {
    // Nothing to play out: a drawn pool bout is a real result, so the referee
    // simply ends it.
    wire(
      levelBracket({
        match_number_label: 'L1-P1-M01',
        phases: { type: 'pool', tournaments: { ruleset_config: {} } },
      }),
    );

    await expect(service.advanceLevelResolution('m1')).rejects.toThrow(/No further remedy/);
  });

  it('refuses when the scores are NOT level', async () => {
    wire(levelBracket({ red_score: 3, blue_score: 1 }));

    await expect(service.advanceLevelResolution('m1')).rejects.toThrow(/not level/);
    expect(inserted).toEqual([]);
  });

  it('refuses a bout that already carries a winner', async () => {
    // 0-0 with a recorded winner is a forfeit under a zeroing score policy. It
    // looks level and is decided; the ladder is what says so.
    wire(levelBracket({ red_score: 0, blue_score: 0, winner_registration_id: 'blue' }));

    await expect(service.advanceLevelResolution('m1')).rejects.toThrow(/not level/);
  });

  it('refuses a completed bout, and a locked one', async () => {
    wire(levelBracket({ status: 'completed' }));
    await expect(service.advanceLevelResolution('m1')).rejects.toThrow(/already completed/);

    wire(levelBracket({ locked_at: '2026-04-25T10:00:00.000Z' }));
    await expect(service.advanceLevelResolution('m1')).rejects.toThrow(/locked/);
  });

  it('refuses while the bout still has time to run', async () => {
    // The other door onto the chain. Without this a referee could collect the
    // extra time at 2-2 with a minute still to fight, and the chain would be
    // spent before the bout was.
    wire(levelBracket(), EARLY);

    await expect(service.advanceLevelResolution('m1')).rejects.toThrow(/Time is not finished/);
    expect(inserted).toEqual([]);
  });

  it('puts the seconds back in COUNT-UP too', async () => {
    // `timerMode` is display only — the bout ends at the limit either way — so a
    // count-up bout that did not rewind could have its End accepted the instant
    // the extra time was granted, and the minute would exist only as advice.
    wire(
      levelBracket({
        phases: {
          type: 'single_elim',
          tournaments: { ruleset_config: { matchFormat: { timerMode: 'countup' } } },
        },
      }),
    );

    await service.advanceLevelResolution('m1');

    expect(inserted.find((r) => r['type'] === 'adjust_time')?.['adjustment_ms']).toBe(-60_000);
  });

  it('asks for the columns it decides on', async () => {
    // The chain answers with the whole fixture whatever the query asked for, so
    // every assertion above survives deleting these from the select while the
    // real read would return none of them.
    wire(levelBracket());

    await service.advanceLevelResolution('m1');

    for (const column of [
      'red_score',
      'blue_score',
      'winner_registration_id',
      'match_number_label',
      'phases(',
    ]) {
      expect(matchProjection).toContain(column);
    }
  });
});
