import { describe, expect, it } from 'vitest';
import { correctionOutcome, type CorrectionInput } from './correction-outcome';

type Over = Omit<Partial<CorrectionInput>, 'bout'> & { bout?: Partial<CorrectionInput['bout']> };

/** A bout Red won 5-4 when the time ran out, on an over Event, feeding nothing. */
function input(over: Over = {}): CorrectionInput {
  const { bout, ...rest } = over;
  return {
    bout: {
      status: 'completed',
      winnerRegistrationId: 'red',
      endReason: 'time_limit',
      redRegistrationId: 'red',
      blueRegistrationId: 'blue',
      redScore: 5,
      blueScore: 4,
      ...bout,
    },
    score: { redScore: 3, blueScore: 4 },
    engine: { isOver: false },
    staysFinished: true,
    laterBoutFought: false,
    drawAllowed: false,
    ...rest,
  };
}

const capReached = (winner: string | null, reason = 'first_to_points') => ({
  isOver: true as const,
  reason,
  winnerRegistrationId: winner,
});

describe('correctionOutcome — an over Event', () => {
  it('the winner follows the score, and the bout stays finished (ruling 225)', () => {
    expect(correctionOutcome(input())).toEqual({
      kind: 'redecide',
      winnerRegistrationId: 'blue',
      endReason: 'time_limit',
    });
  });

  it('a correction that leaves the same leader moves only the score', () => {
    expect(correctionOutcome(input({ score: { redScore: 5, blueScore: 3 } }))).toEqual({
      kind: 'unchanged',
    });
  });

  it('a cap bout that falls below the cap is decided by who leads', () => {
    const fell = input({
      bout: { endReason: 'first_to_points', redScore: 7, blueScore: 6 },
      score: { redScore: 5, blueScore: 6 },
    });
    expect(correctionOutcome(fell)).toEqual({
      kind: 'redecide',
      winnerRegistrationId: 'blue',
      endReason: 'time_limit',
    });
  });

  it('a cap bout that falls below the cap with the same leader keeps its result', () => {
    const fell = input({
      bout: { endReason: 'first_to_points', redScore: 7, blueScore: 5 },
      score: { redScore: 6, blueScore: 5 },
    });
    expect(correctionOutcome(fell)).toEqual({ kind: 'unchanged' });
  });

  it('takes the engine at its word while the cap or the ceiling still ends the bout', () => {
    const other = input({
      bout: { endReason: 'first_to_points', redScore: 7, blueScore: 5 },
      score: { redScore: 5, blueScore: 7 },
      engine: capReached('blue'),
    });
    expect(correctionOutcome(other)).toEqual({
      kind: 'redecide',
      winnerRegistrationId: 'blue',
      endReason: 'first_to_points',
    });
  });

  it('a voided double under a double loss gives the bout back to its leader', () => {
    const doubleLoss = input({
      bout: { winnerRegistrationId: null, endReason: 'max_doubles', redScore: 0, blueScore: 0 },
      score: { redScore: 2, blueScore: 1 },
    });
    expect(correctionOutcome(doubleLoss)).toEqual({
      kind: 'redecide',
      winnerRegistrationId: 'red',
      endReason: 'time_limit',
    });
  });

  it('reads a winner-less bout from before the clock named winners off its board', () => {
    // 5-4 with no stored winner already reads as a win for Red, so 5-3 changes nothing.
    const old = input({
      bout: { winnerRegistrationId: null },
      score: { redScore: 5, blueScore: 3 },
    });
    expect(correctionOutcome(old)).toEqual({ kind: 'unchanged' });
  });

  it('a bout the clock ended as a draw carries no reason, and still follows', () => {
    const drawn = input({
      bout: { winnerRegistrationId: null, endReason: null, redScore: 3, blueScore: 3 },
      score: { redScore: 3, blueScore: 2 },
    });
    expect(correctionOutcome(drawn)).toEqual({
      kind: 'redecide',
      winnerRegistrationId: 'red',
      endReason: 'time_limit',
    });
  });

  it('a result recorded by hand with no reason is not a draw the clock ended', () => {
    const byHand = input({ bout: { winnerRegistrationId: 'red', endReason: null } });
    expect(correctionOutcome(byHand)).toEqual({ kind: 'unchanged' });
  });

  it.each<string | null>(['forfeit', 'black_card', 'rounds_spent', 'a_reason_added_later', null])(
    'never takes back a bout that ended for %s',
    (endReason) => {
      expect(correctionOutcome(input({ bout: { endReason } }))).toEqual({ kind: 'unchanged' });
    },
  );

  it('refuses whole when a later bout was fought from the result (ruling 226)', () => {
    expect(correctionOutcome(input({ laterBoutFought: true }))).toEqual({
      kind: 'refuse',
      code: 'correction_later_bout_fought',
    });
  });

  it('a later fought bout does not refuse a correction that keeps the result', () => {
    const same = input({ laterBoutFought: true, score: { redScore: 5, blueScore: 3 } });
    expect(correctionOutcome(same)).toEqual({ kind: 'unchanged' });
  });

  it('a level board is a draw where the rules allow one (ruling 227)', () => {
    const level = input({ score: { redScore: 4, blueScore: 4 }, drawAllowed: true });
    expect(correctionOutcome(level)).toEqual({
      kind: 'redecide',
      winnerRegistrationId: null,
      endReason: 'time_limit',
    });
  });

  it('a level board is refused whole where the rules ask for a remedy', () => {
    expect(correctionOutcome(input({ score: { redScore: 4, blueScore: 4 } }))).toEqual({
      kind: 'refuse',
      code: 'correction_leaves_bout_level',
    });
  });

  it('a draw the doubles ceiling decides needs no draw step', () => {
    const ceiling = input({
      score: { redScore: 0, blueScore: 0 },
      engine: capReached(null, 'max_doubles_draw'),
    });
    expect(correctionOutcome(ceiling)).toEqual({
      kind: 'redecide',
      winnerRegistrationId: null,
      endReason: 'max_doubles_draw',
    });
  });
});

describe('correctionOutcome — a running Event', () => {
  it('a Swiss bout with a later round drawn cannot reopen, so its winner follows (228)', () => {
    // The caller says so through `staysFinished`: the default of this fixture.
    expect(correctionOutcome(input({ staysFinished: true })).kind).toBe('redecide');
  });

  it('a bout that is not completed is left to the recompute', () => {
    expect(correctionOutcome(input({ staysFinished: false, bout: { status: 'paused' } }))).toEqual({
      kind: 'unchanged',
    });
  });

  it('a bout that is no longer over goes back to the referee, as before', () => {
    expect(correctionOutcome(input({ staysFinished: false }))).toEqual({ kind: 'reopen' });
  });

  it('goes back to the referee even when the same fighter still leads', () => {
    const same = input({ staysFinished: false, score: { redScore: 5, blueScore: 3 } });
    expect(correctionOutcome(same)).toEqual({ kind: 'reopen' });
  });

  it('a forfeited bout that is no longer over still goes back, as before', () => {
    const forfeit = input({ staysFinished: false, bout: { endReason: 'forfeit' } });
    expect(correctionOutcome(forfeit)).toEqual({ kind: 'reopen' });
  });

  it('refuses whole when the result would change and a later bout was fought', () => {
    expect(correctionOutcome(input({ staysFinished: false, laterBoutFought: true }))).toEqual({
      kind: 'refuse',
      code: 'correction_later_bout_fought',
    });
  });

  it('keeps the old path when a later bout was fought and the result stands', () => {
    const same = input({
      staysFinished: false,
      laterBoutFought: true,
      score: { redScore: 5, blueScore: 3 },
    });
    expect(correctionOutcome(same)).toEqual({ kind: 'reopen' });
  });

  it('a bout still over with another result names it at once (ruling 229)', () => {
    const other = input({
      staysFinished: false,
      bout: { endReason: 'first_to_points', redScore: 7, blueScore: 5 },
      score: { redScore: 5, blueScore: 7 },
      engine: capReached('blue'),
    });
    expect(correctionOutcome(other)).toEqual({
      kind: 'redecide',
      winnerRegistrationId: 'blue',
      endReason: 'first_to_points',
    });
  });

  it('a forfeited bout the cap still ends keeps its winner', () => {
    const forfeit = input({
      staysFinished: false,
      bout: { endReason: 'forfeit' },
      engine: capReached('blue'),
    });
    expect(correctionOutcome(forfeit)).toEqual({ kind: 'unchanged' });
  });
});
