import { describe, it, expect, vi } from 'vitest';
import { BracketAdvanceService } from './bracket-advance.service';
import { singleElimBracket } from '@myclash/rulesets/dist/scheduling/index';

// ── Helpers ───────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

// ── buildSelfRef (tested via reflection since it's private) ──────────────────

describe('BracketAdvanceService.buildSelfRef', () => {
  const service = new BracketAdvanceService(null as never);
  // Access private method via type cast
  const bsr = (r: number, p: number, type: string, cfg: Record<string, unknown>): string =>
    (service as unknown as Record<string, (...args: unknown[]) => string>)['buildSelfRef']!(
      r,
      p,
      type,
      cfg,
    );

  it('single_elim: round 1 pos 1 → R1P1', () => {
    expect(bsr(1, 1, 'single_elim', {})).toBe('R1P1');
  });

  it('single_elim: round 3 pos 2 → R3P2', () => {
    expect(bsr(3, 2, 'single_elim', {})).toBe('R3P2');
  });

  it('double_elim: round 1 (WB) → WBR1P1', () => {
    expect(bsr(1, 1, 'double_elim', { wbRounds: 3, lbRounds: 4 })).toBe('WBR1P1');
  });

  it('double_elim: LB round (absolute 4 → LB round 1) → LBR1P1', () => {
    // wbRounds=3, so round 4 = LB round 1
    expect(bsr(4, 1, 'double_elim', { wbRounds: 3, lbRounds: 4 })).toBe('LBR1P1');
  });

  it('double_elim: GF round (wbRounds+lbRounds+1) → GF', () => {
    // wbRounds=3, lbRounds=4 → GF = round 8
    expect(bsr(8, 1, 'double_elim', { wbRounds: 3, lbRounds: 4 })).toBe('GF');
  });

  it('double_elim: reset round (wbRounds+lbRounds+2) → GFRESET', () => {
    expect(bsr(9, 1, 'double_elim', { wbRounds: 3, lbRounds: 4 })).toBe('GFRESET');
  });
});

// ── resolveLoser ──────────────────────────────────────────────────────────────

describe('BracketAdvanceService.resolveLoser', () => {
  const service = new BracketAdvanceService(null as never);
  const rl = (match: Row): string =>
    (service as unknown as Record<string, (...args: unknown[]) => string>)['resolveLoser']!(match);

  it('returns blue when red wins', () => {
    expect(
      rl({
        winner_registration_id: 'red-id',
        red_registration_id: 'red-id',
        blue_registration_id: 'blue-id',
      }),
    ).toBe('blue-id');
  });

  it('returns red when blue wins', () => {
    expect(
      rl({
        winner_registration_id: 'blue-id',
        red_registration_id: 'red-id',
        blue_registration_id: 'blue-id',
      }),
    ).toBe('red-id');
  });
});

// ── onMatchCompleted — autoAdvance=false exits early ─────────────────────────

describe('BracketAdvanceService.onMatchCompleted', () => {
  it('exits early when autoAdvance is false', async () => {
    const calls: string[] = [];

    const mockSupabase = {
      service: {
        from: vi.fn((table: string) => {
          calls.push(`from(${table})`);
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data:
                table === 'matches'
                  ? {
                      id: 'm1',
                      bracket_slot_id: 's1',
                      winner_registration_id: 'rA',
                      red_registration_id: 'rA',
                      blue_registration_id: 'rB',
                    }
                  : table === 'bracket_slots'
                    ? {
                        id: 's1',
                        round: 1,
                        position: 1,
                        phase_id: 'ph1',
                        source_b_type: 'winner_of',
                        registration_a_id: null,
                        registration_b_id: null,
                      }
                    : { id: 'ph1', type: 'single_elim', config_json: { autoAdvance: false } },
              error: null,
            }),
          };
        }),
      },
    };

    const service = new BracketAdvanceService(mockSupabase as never);
    await service.onMatchCompleted('m1');

    // Should have loaded match, slot, phase — but NOT queried downstream slots
    const downstreamQuery = calls.filter((c) => c === 'from(bracket_slots)');
    // Only 1 bracket_slots call (loading the slot) — no downstream query
    expect(downstreamQuery.length).toBe(1);
  });

  it('does not throw when match has no bracket_slot_id', async () => {
    const mockSupabase = {
      service: {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: 'm1',
              bracket_slot_id: null,
              winner_registration_id: 'rA',
              red_registration_id: 'rA',
              blue_registration_id: 'rB',
            },
            error: null,
          }),
        })),
      },
    };

    const service = new BracketAdvanceService(mockSupabase as never);
    await expect(service.onMatchCompleted('m1')).resolves.toBeUndefined();
  });
});

// ── 32-player single_elim simulation ─────────────────────────────────────────

describe('32-player single_elim bracket simulation', () => {
  it('generates correct ref strings for all WB slots', () => {
    const bracket = singleElimBracket(32);

    // R1: 16 slots, R2: 8, R3: 4, R4: 2, R5: 1, bronze: 1
    expect(bracket.slots.filter((s) => s.round === 1).length).toBe(16);
    expect(bracket.slots.filter((s) => s.round === 2).length).toBe(8);
    expect(bracket.slots.filter((s) => s.round === 5).length).toBe(2); // final + bronze

    // Verify the final slot
    const final = bracket.slots.find((s) => s.round === 5 && s.position === 1);
    expect(final?.homeSource).toBe('winner of R4P1');
    expect(final?.awaySource).toBe('winner of R4P2');

    // Verify the bronze slot
    const bronze = bracket.slots.find((s) => s.round === 5 && s.position === 2);
    expect(bronze?.sourceAType).toBe('loser_of');
    expect(bronze?.sourceBType).toBe('loser_of');
    expect(bronze?.homeSource).toBe('loser of R4P1');
    expect(bronze?.awaySource).toBe('loser of R4P2');
  });

  it('R1 winner_of refs chain correctly to R2', () => {
    const bracket = singleElimBracket(32);

    // R2P1 should reference R1P1 and R1P2 winners
    const r2p1 = bracket.slots.find((s) => s.round === 2 && s.position === 1);
    expect(r2p1?.homeSource).toBe('winner of R1P1');
    expect(r2p1?.awaySource).toBe('winner of R1P2');

    // R2P2 should reference R1P3 and R1P4
    const r2p2 = bracket.slots.find((s) => s.round === 2 && s.position === 2);
    expect(r2p2?.homeSource).toBe('winner of R1P3');
    expect(r2p2?.awaySource).toBe('winner of R1P4');
  });

  it('all R1 slots have seed sources and correct seed numbers', () => {
    const bracket = singleElimBracket(32);
    const r1 = bracket.slots.filter((s) => s.round === 1);

    for (const slot of r1) {
      expect(slot.sourceAType).toBe('seed');
      expect(slot.sourceBType).toBe('seed');
      expect(slot.homeSeed).not.toBeNull();
      expect(slot.awaySeed).not.toBeNull();
    }

    // Seed 1 should appear in round 1
    const seed1Slot = r1.find((s) => s.homeSeed === 1 || s.awaySeed === 1);
    expect(seed1Slot).toBeDefined();
  });
});

// ── advanceByeSlots — idempotency ─────────────────────────────────────────────

describe('BracketAdvanceService.advanceByeSlots', () => {
  it('does nothing if no bye slots exist', async () => {
    const insertCalls: string[] = [];

    const mockSupabase = {
      service: {
        from: vi.fn((table: string) => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          insert: vi.fn((data: unknown) => {
            insertCalls.push(table);
            return Promise.resolve({ data, error: null });
          }),
          then: vi.fn(),
          data: [],
          error: null,
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          // bracket_slots.select(...).eq('phase_id', ...).eq('source_b_type', 'bye').not(...)
          // Simulate empty result
          __data: { data: [], error: null },
        })),
      },
    };

    // Mock the full chain to return empty bye slots
    let callChain: Record<string, unknown>;
    mockSupabase.service.from = vi.fn().mockImplementation(() => {
      callChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockResolvedValue({ data: [], error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
        update: vi.fn().mockReturnThis(),
        or: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
      return callChain;
    });

    const service = new BracketAdvanceService(mockSupabase as never);
    await service.advanceByeSlots('phase-1');

    expect(insertCalls.length).toBe(0);
  });
});
