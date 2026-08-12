import { describe, it, expect, vi } from 'vitest';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { MatchCompletionService } from './match-completion.service';

/**
 * Behavioural tests for the single owner of "a match just completed".
 *
 * These exist because the side effects were previously owned by call sites and
 * went missing twice, silently: first bracket advancement (so a bracket scored
 * on the pad never advanced), then the pool auto-populate sitting on the very
 * next line (so scoring the last pool match left the bracket empty).
 *
 * Asserted on BEHAVIOUR, not on source text. A text guard was tried and proved
 * vacuous — `populateBracket` still appeared in the docstring and in the private
 * method's own name long after the actual call had been deleted.
 */

/** Supabase double returning one match row with its phase embedded. */
function supabaseFor(phase: { type: string; tournament_id: string } | null) {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn().mockResolvedValue({ data: phase ? { phases: phase } : null, error: null }),
  });
  return { service: { from: vi.fn(() => chain) } };
}

/** The freeze is non-optional now, so every construction has to supply it. */
const openEvent = () => ({ assertResultMutationAllowed: vi.fn().mockResolvedValue(undefined) });

const POOL = { type: 'pool', tournament_id: 't1' };
const BRACKET = { type: 'single_elim', tournament_id: 't1' };

describe('MatchCompletionService.onMatchCompleted', () => {
  it('advances the bracket', async () => {
    const bracketAdvance = { onMatchCompleted: vi.fn().mockResolvedValue(undefined) };
    const phases = { populateBracket: vi.fn().mockResolvedValue(undefined) };

    await new MatchCompletionService(
      supabaseFor(BRACKET) as never,
      openEvent() as never,
      bracketAdvance as never,
      phases as never,
    ).onMatchCompleted('m1');

    expect(bracketAdvance.onMatchCompleted).toHaveBeenCalledWith('m1');
  });

  /** The regression: a completed POOL match must try to seed the bracket. */
  it('attempts the pool auto-populate after a pool match', async () => {
    const bracketAdvance = { onMatchCompleted: vi.fn().mockResolvedValue(undefined) };
    const phases = { populateBracket: vi.fn().mockResolvedValue(undefined) };

    await new MatchCompletionService(
      supabaseFor(POOL) as never,
      openEvent() as never,
      bracketAdvance as never,
      phases as never,
    ).onMatchCompleted('m1');

    // silentIfGateNotMet: populate itself decides whether the pools are done.
    expect(phases.populateBracket).toHaveBeenCalledWith('t1', {}, 'system', {
      silentIfGateNotMet: true,
    });
  });

  it('does not auto-populate after a bracket match', async () => {
    const bracketAdvance = { onMatchCompleted: vi.fn().mockResolvedValue(undefined) };
    const phases = { populateBracket: vi.fn().mockResolvedValue(undefined) };

    await new MatchCompletionService(
      supabaseFor(BRACKET) as never,
      openEvent() as never,
      bracketAdvance as never,
      phases as never,
    ).onMatchCompleted('m1');

    expect(phases.populateBracket).not.toHaveBeenCalled();
  });

  /**
   * A side effect must never fail the write that triggered it — an exchange, a
   * clock action, a status change. Both halves are independently guarded, so a
   * throwing advance still lets the populate run.
   */
  it('never throws, and a failing advance still lets the populate run', async () => {
    const bracketAdvance = { onMatchCompleted: vi.fn().mockRejectedValue(new Error('boom')) };
    const phases = { populateBracket: vi.fn().mockRejectedValue(new Error('nope')) };

    await expect(
      new MatchCompletionService(
        supabaseFor(POOL) as never,
        openEvent() as never,
        bracketAdvance as never,
        phases as never,
      ).onMatchCompleted('m1'),
    ).resolves.toBeUndefined();

    expect(bracketAdvance.onMatchCompleted).toHaveBeenCalled();
    expect(phases.populateBracket).toHaveBeenCalled();
  });

  it('is inert when its optional dependencies are not wired', async () => {
    await expect(
      new MatchCompletionService(supabaseFor(POOL) as never, openEvent() as never).onMatchCompleted(
        'm1',
      ),
    ).resolves.toBeUndefined();
  });
});

// ── onMatchUncompleted ────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

/**
 * A four-slot single elim: R1P1 and R1P2 feed the final at R2P1.
 *
 * `foughtFinal` decides whether the bout the un-completion would invalidate has
 * already been played, which is the only question the three outcomes turn on.
 */
function bracketFixture(foughtFinal: boolean) {
  const slot = (
    id: string,
    round: number,
    position: number,
    a: string | null,
    b: string | null,
  ): Row => ({
    id,
    phase_id: 'phase-1',
    round,
    position,
    source_a_ref: a,
    source_b_ref: b,
    source_b_type: a ? 'winner_of' : 'seed',
    registration_a_id: null,
    registration_b_id: null,
  });
  const match = (id: string, slotId: string, played: boolean): Row => ({
    id,
    bracket_slot_id: slotId,
    status: played ? 'completed' : 'scheduled',
    started_at: played ? '2026-08-12T10:00:00.000Z' : null,
    locked_at: null,
    match_number_label: id,
    winner_registration_id: played ? 'reg-a' : null,
    red_registration_id: 'reg-a',
    blue_registration_id: 'reg-c',
  });
  return {
    slots: [
      slot('slot-r1p1', 1, 1, null, null),
      slot('slot-r1p2', 1, 2, null, null),
      slot('slot-final', 2, 1, 'winner of R1P1', 'winner of R1P2'),
    ],
    matches: [
      match('match-r1p1', 'slot-r1p1', true),
      match('match-final', 'slot-final', foughtFinal),
    ],
  };
}

/** Records every write so the assertions can be about effects, not calls. */
function uncompleteSupabase(fixture: {
  slots: Row[];
  matches: Row[];
  match_forfeits?: Row[];
  registrations?: Row[];
}) {
  const writes: Array<{ table: string; row: Row }> = [];
  const tableRows: Record<string, Row[]> = {
    bracket_slots: fixture.slots,
    matches: fixture.matches,
    phases: [{ id: 'phase-1', type: 'single_elim', config_json: { bracketSize: 4 } }],
    match_forfeits: fixture.match_forfeits ?? [],
    registrations: fixture.registrations ?? [],
  };
  const from = (table: string) => {
    let rows: Row[] = tableRows[table] ?? [];
    const api: Record<string, unknown> = {};
    Object.assign(api, {
      select: () => api,
      order: () => api,
      limit: () => api,
      eq: (column: string, value: unknown) => {
        rows = rows.filter((row) => row[column] === value);
        return api;
      },
      in: (column: string, values: unknown[]) => {
        rows = rows.filter((row) => values.includes(row[column]));
        return api;
      },
      not: (column: string, _op: string, value: unknown) => {
        rows = rows.filter((row) => row[column] !== value);
        return api;
      },
      // `.is('voided_at', null)` — a column absent from a fixture row reads as
      // null, which is what an un-voided forfeit record actually looks like.
      is: (column: string, value: unknown) => {
        rows = rows.filter((row) => (row[column] ?? null) === value);
        return api;
      },
      update: (row: Row) => {
        writes.push({ table, row });
        return api;
      },
      insert: (row: Row) => {
        writes.push({ table, row });
        return Promise.resolve({ error: null });
      },
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null }),
    });
    return api;
  };
  return { service: { from }, writes };
}

const ORGANISER = { userId: 'organiser-1', canDiscardDependentResults: true };

describe('MatchCompletionService.onMatchUncompleted', () => {
  it('clears what the match fed when no later bout has been fought', async () => {
    const supabase = uncompleteSupabase(bracketFixture(false));
    const bracketAdvance = { clearDownstreamOf: vi.fn().mockResolvedValue(undefined) };

    await new MatchCompletionService(
      supabase as never,
      openEvent() as never,
      bracketAdvance as never,
    ).onMatchUncompleted('match-r1p1');

    expect(bracketAdvance.clearDownstreamOf).toHaveBeenCalledWith('match-r1p1');
    // Nothing was reverted: no exchange void, no reset_match event.
    expect(supabase.writes.some((w) => w.table === 'exchanges')).toBe(false);
    expect(supabase.writes.some((w) => w.table === 'match_events')).toBe(false);
  });

  it('takes the fighters off the dependent row, which the slot clear does not touch', async () => {
    const supabase = uncompleteSupabase(bracketFixture(false));

    await new MatchCompletionService(
      supabase as never,
      openEvent() as never,
      { clearDownstreamOf: vi.fn().mockResolvedValue(undefined) } as never,
    ).onMatchUncompleted('match-r1p1');

    // Until a re-completion happens the final would otherwise keep naming a
    // pair that has not earned it — and the pad validates nothing against the
    // slot before starting a bout.
    expect(supabase.writes).toContainEqual({
      table: 'matches',
      row: { red_registration_id: null, blue_registration_id: null },
    });
  });

  it('refuses, naming the count, when a later bout has been fought', async () => {
    const supabase = uncompleteSupabase(bracketFixture(true));

    await expect(
      new MatchCompletionService(
        supabase as never,
        openEvent() as never,
        { clearDownstreamOf: vi.fn() } as never,
      ).onMatchUncompleted('match-r1p1'),
    ).rejects.toThrow(ConflictException);

    // Refused before anything was written.
    expect(supabase.writes).toEqual([]);
  });

  it('refuses an acknowledged discard from an actor who may not discard', async () => {
    const supabase = uncompleteSupabase(bracketFixture(true));

    await expect(
      new MatchCompletionService(
        supabase as never,
        openEvent() as never,
        { clearDownstreamOf: vi.fn() } as never,
      ).onMatchUncompleted('match-r1p1', {
        discardDependents: true,
        // A pad staff token: no userId, no discard capability.
        actor: { staffAccountId: 'staff-1' },
      }),
    ).rejects.toThrow(ForbiddenException);

    expect(supabase.writes).toEqual([]);
  });

  it('reverts the fought dependent when an organiser accepts the loss', async () => {
    const supabase = uncompleteSupabase(bracketFixture(true));
    const bracketAdvance = { clearDownstreamOf: vi.fn().mockResolvedValue(undefined) };

    await new MatchCompletionService(
      supabase as never,
      openEvent() as never,
      bracketAdvance as never,
    ).onMatchUncompleted('match-r1p1', { discardDependents: true, actor: ORGANISER });

    // The bout goes back to unplayed…
    expect(supabase.writes.some((w) => w.table === 'exchanges' && w.row['voided'] === true)).toBe(
      true,
    );
    expect(
      supabase.writes.some((w) => w.table === 'matches' && w.row['status'] === 'scheduled'),
    ).toBe(true);
    // …with the event that returns its clock to idle, without which the pad
    // could not start the replay.
    expect(
      supabase.writes.some((w) => w.table === 'match_events' && w.row['type'] === 'reset_match'),
    ).toBe(true);
    // …and the sides IT fed are cleared too, not just the root's. One level is
    // not enough: the stale-side bug just moves a round along.
    expect(bracketAdvance.clearDownstreamOf).toHaveBeenCalledWith('match-r1p1');
    expect(bracketAdvance.clearDownstreamOf).toHaveBeenCalledWith('match-final');
  });

  /**
   * The freeze must reach this path. It is checked ONCE on the root — it is a
   * per-event question and it throws, so asking inside the revert loop would
   * abort a half-applied cascade with no transaction to undo it.
   */
  it('lets the frozen-results refusal through instead of swallowing it', async () => {
    const supabase = uncompleteSupabase(bracketFixture(false));
    const frozen = {
      assertResultMutationAllowed: vi
        .fn()
        .mockRejectedValue(new ConflictException('Event results are frozen')),
    };

    await expect(
      new MatchCompletionService(
        supabase as never,
        frozen as never,
        { clearDownstreamOf: vi.fn() } as never,
      ).onMatchUncompleted('match-r1p1'),
    ).rejects.toThrow(ConflictException);

    expect(supabase.writes).toEqual([]);
  });

  /**
   * A forfeit record whose whole effect was its own bout: the fighter's
   * `registrations.status` still reads exactly what the record captured, which
   * is what `applyTournamentState` leaves behind when it decides not to move
   * them at all.
   */
  const matchOnlyForfeit = (over: Row = {}) => ({
    match_forfeits: [
      {
        id: 'forfeit-1',
        match_id: 'match-r1p1',
        forfeiting_registration_id: 'reg-a',
        replacement_registration_id: null,
        previous_registration_state: { status: 'checked_in' },
        parent_forfeit_id: null,
        voided_at: null,
        ...over,
      },
    ],
    registrations: [{ id: 'reg-a', status: 'checked_in' }],
  });

  it('voids the bout’s forfeit, and writes nothing but that', async () => {
    // The F keys on `voided_at IS NULL` in pool standings, Swiss standings and
    // the HEMA export — and `match_forfeits_one_active_per_match` means the
    // replayed bout cannot be re-forfeited while the stale record stands.
    const supabase = uncompleteSupabase({ ...bracketFixture(false), ...matchOnlyForfeit() });

    await new MatchCompletionService(
      supabase as never,
      openEvent() as never,
      { clearDownstreamOf: vi.fn().mockResolvedValue(undefined) } as never,
    ).onMatchUncompleted('match-r1p1', { actor: { userId: 'organiser-1' } });

    const voided = supabase.writes.filter((w) => w.table === 'match_forfeits');
    expect(voided).toHaveLength(1);
    expect(voided[0]?.row).toMatchObject({ voided_by_user_id: 'organiser-1' });
    expect(voided[0]?.row['voided_at']).toEqual(expect.any(String));

    // THE UN-DQ GUARD. Reopen on the pad reaches this same owner, so a
    // registration write here is a disqualification reversed by a clock button.
    // On the path that passes, previous === current — there is nothing to undo.
    expect(supabase.writes.some((w) => w.table === 'registrations')).toBe(false);
  });

  it('voids the forfeit LAST, after the bout has been put back', async () => {
    // Crash before it and the state is exactly today's: F standing, row still
    // completed, and `MatchesService.uncomplete` still sees `completed` so a
    // re-run converges. Crash after voiding first and the standings show a win
    // for a bout nobody fought, with no record explaining it.
    const supabase = uncompleteSupabase({ ...bracketFixture(true), ...matchOnlyForfeit() });

    await new MatchCompletionService(
      supabase as never,
      openEvent() as never,
      { clearDownstreamOf: vi.fn().mockResolvedValue(undefined) } as never,
    ).onMatchUncompleted('match-r1p1', { discardDependents: true, actor: ORGANISER });

    const tables = supabase.writes.map((w) => w.table);
    expect(tables.indexOf('match_forfeits')).toBeGreaterThan(tables.lastIndexOf('matches'));
  });

  it('refuses when the forfeit also took the fighter out of the tournament', async () => {
    // `previous_registration_state` is captured for every root record whether or
    // not `applyTournamentState` wrote anything, so the record alone proves
    // nothing. The fighter's CURRENT status having moved is the evidence.
    const supabase = uncompleteSupabase({
      ...bracketFixture(false),
      ...matchOnlyForfeit(),
      registrations: [{ id: 'reg-a', status: 'disqualified' }],
    });

    await expect(
      new MatchCompletionService(
        supabase as never,
        openEvent() as never,
        { clearDownstreamOf: vi.fn() } as never,
      ).onMatchUncompleted('match-r1p1', { actor: ORGANISER }),
    ).rejects.toThrow(ConflictException);

    expect(supabase.writes).toEqual([]);
  });

  it('refuses while the record still carries live children', async () => {
    // A withdrawal auto-forfeited the fighter's remaining pool bouts. Undoing
    // the trigger here would put this bout back while those stayed forfeited.
    const forfeit = matchOnlyForfeit();
    const supabase = uncompleteSupabase({
      ...bracketFixture(false),
      ...forfeit,
      match_forfeits: [
        ...forfeit.match_forfeits,
        {
          id: 'forfeit-child',
          match_id: 'pool-later',
          forfeiting_registration_id: 'reg-a',
          replacement_registration_id: null,
          // A child captures `{}` — the PARENT owns the fighter's status.
          previous_registration_state: {},
          parent_forfeit_id: 'forfeit-1',
          voided_at: null,
        },
      ],
    });

    await expect(
      new MatchCompletionService(
        supabase as never,
        openEvent() as never,
        { clearDownstreamOf: vi.fn() } as never,
      ).onMatchUncompleted('match-r1p1', { actor: ORGANISER }),
    ).rejects.toThrow(ConflictException);

    expect(supabase.writes).toEqual([]);
  });

  it('voids a record that swapped a reserve in, without touching the bracket', async () => {
    // Reachable only once the reserve has actually fought — and at that point
    // `voidForfeit` refuses forever (`resulting_match_state` says 'scheduled'),
    // so refusing here too would leave the record unremovable by any route while
    // the HEMA export keeps dropping a real bout as a walkover.
    //
    // Entering a substitute changed the FIELD, not this result. Undoing a result
    // must not un-enter a fighter who may have fought elsewhere since.
    const supabase = uncompleteSupabase({
      ...bracketFixture(false),
      ...matchOnlyForfeit({ replacement_registration_id: 'reg-reserve' }),
    });

    await new MatchCompletionService(
      supabase as never,
      openEvent() as never,
      { clearDownstreamOf: vi.fn().mockResolvedValue(undefined) } as never,
    ).onMatchUncompleted('match-r1p1', { actor: ORGANISER });

    expect(supabase.writes.filter((w) => w.table === 'match_forfeits')).toHaveLength(1);
    expect(supabase.writes.some((w) => w.table === 'bracket_slots')).toBe(false);
  });

  it('no-ops for a pool match, which feeds no slot', async () => {
    const supabase = uncompleteSupabase({
      slots: [],
      matches: [{ id: 'pool-match', bracket_slot_id: null }],
    });
    const bracketAdvance = { clearDownstreamOf: vi.fn().mockResolvedValue(undefined) };

    await new MatchCompletionService(
      supabase as never,
      openEvent() as never,
      bracketAdvance as never,
    ).onMatchUncompleted('pool-match');

    expect(supabase.writes).toEqual([]);
  });
});
