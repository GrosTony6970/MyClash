import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { dependentClosure } from './bracket-dependents';
import { doubleElimBracket, singleElimBracket } from '@myclash/rules/scheduling';

/**
 * The closure is driven by the REAL generators rather than hand-built slot rows.
 *
 * The ref strings are the whole mechanism — a mismatch between what
 * `buildSelfRef` stamps and what the generator emits is a silent permanent
 * stall, not an error — so a fixture that invents its own refs would agree with
 * itself and prove nothing about the bracket the app actually builds.
 */

type Row = Record<string, unknown>;

interface Fixture {
  slots: Row[];
  matches: Row[];
  phase: Row;
}

/**
 * A second phase, and one slot of it that stamps the refs this bracket's root
 * stamps.
 *
 * `bracket_slots` constrains nothing about `source_*_ref`, so two phases of the
 * same size emit the same strings — a second tournament's R2P1 is fed by
 * `winner of R1P1` exactly like this one's. Without these rows the three phase
 * scopes decide nothing: one phase and one phase's slots answer the same
 * whether the query scopes itself or not.
 */
const OTHER_PHASE: Row = { id: 'phase-2', type: 'single_elim', config_json: {} };

const FOREIGN_SLOT: Row = {
  id: 'foreign-slot',
  phase_id: 'phase-2',
  round: 2,
  position: 1,
  // R1P1 is what a single-elimination root stamps, WBR1P1 a double-elimination
  // one — so this slot is reachable from the root of every fixture below.
  source_a_ref: 'winner of R1P1',
  source_b_ref: 'winner of WBR1P1',
};

/**
 * A live match on that foreign slot.
 *
 * Seeded so the `.in('bracket_slot_id', …)` verdict means something: the row
 * exists, the filter excludes it, and the closure cannot observe it either way
 * because `liveMatch` is keyed by slot id and read only for slots the
 * phase-scoped query returned.
 */
const FOREIGN_MATCH: Row = {
  id: 'foreign-match',
  bracket_slot_id: 'foreign-slot',
  status: 'completed',
  started_at: '2026-08-12T09:00:00.000Z',
  locked_at: null,
  match_number_label: 'X',
};

/** The three tables `dependentClosure` reads, on the shared double. */
function supabaseFor(fixture: Fixture) {
  return mockSupabase({
    bracket_slots: { rows: [...fixture.slots, FOREIGN_SLOT] },
    matches: { rows: [...fixture.matches, FOREIGN_MATCH] },
    phases: { rows: [fixture.phase, OTHER_PHASE] },
  }).service as never;
}

/** Turn a generator's slot list into bracket_slots + one live match per slot. */
function fixtureFrom(generated: GeneratedSlot[], phase: Row): Fixture {
  const slots: Row[] = generated.map((slot, index) => ({
    id: `slot-${index}`,
    phase_id: 'phase-1',
    round: slot.round,
    position: slot.position,
    source_a_ref: slot.homeSource ?? null,
    source_b_ref: slot.awaySource ?? null,
    source_b_type: 'winner_of',
    registration_a_id: null,
    registration_b_id: null,
  }));
  const matches: Row[] = slots.map((slot, index) => ({
    id: `match-${index}`,
    bracket_slot_id: slot['id'],
    status: 'scheduled',
    started_at: null,
    locked_at: null,
    match_number_label: String(index),
    winner_registration_id: null,
    red_registration_id: 'reg-a',
    blue_registration_id: 'reg-b',
  }));
  return { slots, matches, phase };
}

interface GeneratedSlot {
  round: number;
  position: number;
  homeSource?: string | null;
  awaySource?: string | null;
}

const slotsOf = (bracket: unknown): GeneratedSlot[] =>
  (bracket as { slots: GeneratedSlot[] }).slots;

describe('dependentClosure', () => {
  it('returns nothing for a match that feeds no bracket slot', async () => {
    const fixture: Fixture = {
      slots: [],
      matches: [{ id: 'pool-match', bracket_slot_id: null }],
      phase: { id: 'phase-1', type: 'pool', config_json: {} },
    };
    const supabase = supabaseFor(fixture);

    expect(await dependentClosure(supabase, 'pool-match')).toEqual([]);
  });

  it('single elim: a round-1 win reaches every later round, once each', async () => {
    const bracket = singleElimBracket(8);
    const phase = {
      id: 'phase-1',
      type: 'single_elim',
      config_json: { bracketSize: 8 },
    };
    const fixture = fixtureFrom(slotsOf(bracket), phase);
    // Round 1 position 1 → its slot is index 0 in the generated order.
    const rootSlot = fixture.slots.find((s) => s['round'] === 1 && s['position'] === 1)!;
    const rootMatch = fixture.matches.find((m) => m['bracket_slot_id'] === rootSlot['id'])!;
    const supabase = supabaseFor(fixture);

    const closure = await dependentClosure(supabase, rootMatch['id'] as string);

    // Three, not two. `singleElimBracket(8)` emits a bronze match at R3P2 fed by
    // `loser of R2P1`, so R1P1 reaches it too — a walk that followed only
    // `winner of` edges would miss a real bout carrying a real result.
    const reached = closure.map((bout) =>
      fixture.slots.find((slot) => slot['id'] === bout.slotId)!,
    );
    expect(
      reached.map((slot) => `R${slot['round'] as number}P${slot['position'] as number}`),
    ).toEqual(['R3P1', 'R3P2', 'R2P1']);
    // Deduped: each slot appears at most once.
    expect(new Set(closure.map((bout) => bout.slotId)).size).toBe(closure.length);
  });

  /**
   * The measurement that motivated the visited set. In double elimination the
   * WB-loser and LB-winner paths reconverge at every mixed losers round, so a
   * naive recursion re-visits: from WBR1P1 in a 128 bracket it lands on the
   * grand final 8 separate times, 71 visits over 21 distinct nodes. Every
   * per-node action in a cascade would run that many times.
   */
  it('double elim: reconvergent paths yield each slot exactly once', async () => {
    const bracket = doubleElimBracket(8, { grandFinalReset: true });
    const generated = slotsOf(bracket);
    const wbRounds = Math.log2(8);
    const phase = {
      id: 'phase-1',
      type: 'double_elim',
      config_json: {
        grandFinalReset: true,
        wbRounds,
        lbRounds: Math.max(...generated.map((slot) => slot.round)) - wbRounds - 2,
      },
    };
    const fixture = fixtureFrom(generated, phase);
    const rootSlot = fixture.slots.find((s) => s['round'] === 1 && s['position'] === 1)!;
    const rootMatch = fixture.matches.find((m) => m['bracket_slot_id'] === rootSlot['id'])!;
    const supabase = supabaseFor(fixture);

    const closure = await dependentClosure(supabase, rootMatch['id'] as string);

    expect(new Set(closure.map((bout) => bout.slotId)).size).toBe(closure.length);
    expect(closure.length).toBeGreaterThan(3);
  });

  it('orders deepest round first, which is the order a revert must run in', async () => {
    const bracket = singleElimBracket(8);
    const phase = { id: 'phase-1', type: 'single_elim', config_json: { bracketSize: 8 } };
    const fixture = fixtureFrom(slotsOf(bracket), phase);
    const rootSlot = fixture.slots.find((s) => s['round'] === 1 && s['position'] === 1)!;
    const rootMatch = fixture.matches.find((m) => m['bracket_slot_id'] === rootSlot['id'])!;

    const closure = await dependentClosure(supabaseFor(fixture), rootMatch['id'] as string);

    const rounds = closure.map((bout) => bout.round);
    expect([...rounds].sort((a, b) => b - a)).toEqual(rounds);
  });

  it('reports a fought dependent, and does not report an unplayed one', async () => {
    const bracket = singleElimBracket(4);
    const phase = { id: 'phase-1', type: 'single_elim', config_json: { bracketSize: 4 } };
    const fixture = fixtureFrom(slotsOf(bracket), phase);
    const rootSlot = fixture.slots.find((s) => s['round'] === 1 && s['position'] === 1)!;
    const rootMatch = fixture.matches.find((m) => m['bracket_slot_id'] === rootSlot['id'])!;
    // The final has been played.
    const finalSlot = fixture.slots.find((s) => s['round'] === 2)!;
    const finalMatch = fixture.matches.find((m) => m['bracket_slot_id'] === finalSlot['id'])!;
    finalMatch['status'] = 'completed';
    finalMatch['started_at'] = '2026-08-12T10:00:00.000Z';

    const closure = await dependentClosure(supabaseFor(fixture), rootMatch['id'] as string);

    expect(closure.find((bout) => bout.slotId === finalSlot['id'])?.hasBeenFought).toBe(true);
  });

  /**
   * Migration 0094 parks voided rows outside `matches_bracket_slot_id_active_uniq`
   * on purpose, so a replayed slot can carry a fresh live row beside its voided
   * history. Reverting one of those back to 'scheduled' would raise a 23505
   * against that index.
   */
  it('ignores voided history rows and reports the slot as having no live match', async () => {
    const bracket = singleElimBracket(4);
    const phase = { id: 'phase-1', type: 'single_elim', config_json: { bracketSize: 4 } };
    const fixture = fixtureFrom(slotsOf(bracket), phase);
    const rootSlot = fixture.slots.find((s) => s['round'] === 1 && s['position'] === 1)!;
    const rootMatch = fixture.matches.find((m) => m['bracket_slot_id'] === rootSlot['id'])!;
    const finalSlot = fixture.slots.find((s) => s['round'] === 2)!;
    const finalMatch = fixture.matches.find((m) => m['bracket_slot_id'] === finalSlot['id'])!;
    finalMatch['status'] = 'voided';

    const closure = await dependentClosure(supabaseFor(fixture), rootMatch['id'] as string);

    const finalBout = closure.find((bout) => bout.slotId === finalSlot['id']);
    expect(finalBout).toBeDefined();
    expect(finalBout?.matchId).toBeNull();
    expect(finalBout?.hasBeenFought).toBe(false);
  });

  /**
   * The phase scope is the only thing keeping the walk inside one bracket.
   *
   * Ref strings are not unique across the database: every 4-fighter single
   * elimination stamps R1P1 and feeds its final `winner of R1P1`. So an
   * unscoped slot read adopts another tournament's bouts as dependents of this
   * one — and every caller of this closure either reverts them or refuses to
   * proceed because of them.
   */
  it('stays inside the phase, even where another one stamps the same refs', async () => {
    const bracket = singleElimBracket(4);
    const phase = { id: 'phase-1', type: 'single_elim', config_json: { bracketSize: 4 } };
    const fixture = fixtureFrom(slotsOf(bracket), phase);
    const rootSlot = fixture.slots.find((s) => s['round'] === 1 && s['position'] === 1)!;
    const rootMatch = fixture.matches.find((m) => m['bracket_slot_id'] === rootSlot['id'])!;

    const closure = await dependentClosure(supabaseFor(fixture), rootMatch['id'] as string);

    expect(closure.length).toBeGreaterThan(0);
    expect(closure.every((bout) => fixture.slots.some((slot) => slot['id'] === bout.slotId))).toBe(
      true,
    );
  });

  /**
   * Acyclicity is a generator property with zero database enforcement:
   * `bracket_slots` constrains only (phase_id, round, position), `source_*_ref`
   * are unconstrained text, and archive restore writes them verbatim from an
   * uploaded buffer. A self-loop is one hand-edited line away, and a walk that
   * silently truncated would hand a caller a partial dependent list — which for
   * a cascade means a half-reverted bracket.
   */
  it('throws rather than looping forever on a slot graph that cycles', async () => {
    const phase = {
      id: 'phase-1',
      type: 'single_elim',
      config_json: { bracketSize: 4 },
    };
    // Two slots feeding each other: R1P1 → R2P1 → R1P1.
    const slots: Row[] = Array.from({ length: 40 }, (_, index) => ({
      id: `slot-${index}`,
      phase_id: 'phase-1',
      round: index + 1,
      position: 1,
      source_a_ref: `winner of R${index}P1`,
      source_b_ref: null,
    }));
    const matches: Row[] = slots.map((slot, index) => ({
      id: `match-${index}`,
      bracket_slot_id: slot['id'],
      status: 'scheduled',
      started_at: null,
      locked_at: null,
      match_number_label: String(index),
      winner_registration_id: null,
      red_registration_id: 'reg-a',
      blue_registration_id: 'reg-b',
    }));

    await expect(
      dependentClosure(supabaseFor({ slots, matches, phase }), 'match-0'),
    ).rejects.toThrow(BadRequestException);
  });
});
