/**
 * A round press the server refused ("Start round 2", "End round 1"), in the
 * inbox and at the clock: which button and which round, why it is held, and
 * what its discard does.
 *
 * A round press is no hit and no clock press. With no words of its own a held
 * "Start round 2" would read "Queued entry" with "Discard this hit?".
 */
import { describe, expect, it } from 'vitest';
import { canSendAgain } from '../offline/can-send-again';
import { discardQuestion, heldRoundLabel, heldRowNotice, heldWhoLine } from './held-hit';
import { heldReason } from './refusal-copy';

const t = (key: string, values?: Record<string, string | number>) =>
  values ? `${key} ${JSON.stringify(values)}` : key;

describe('the label of a held round press', () => {
  it('names the button and the round', () => {
    expect(heldRoundLabel({ roundAction: 'advance', round: 2 }, t)).toBe(
      'scoring.quarantine.typeRoundAdvance {"round":2}',
    );
    expect(heldRoundLabel({ roundAction: 'end', round: 1 }, t)).toBe(
      'scoring.quarantine.typeRoundEnd {"round":1}',
    );
  });

  it('a row that names no button or no round reads as an entry the pad cannot name', () => {
    expect(heldRoundLabel({ round: 2 }, t)).toBe('scoring.quarantine.typeUnknown');
    expect(heldRoundLabel({ roundAction: 'advance' }, t)).toBe('scoring.quarantine.typeUnknown');
  });
});

describe('who a held round press is about', () => {
  it('is nobody: the label says which button', () => {
    expect(
      heldWhoLine({ kind: 'round', bout: { label: 'P1', red: 'Ana', blue: 'Bo' } }, t),
    ).toBeNull();
  });
});

describe('the question before the discard of a round press', () => {
  it('has its own words: it is no hit and no clock press', () => {
    expect(discardQuestion({ kind: 'round' }, t)).toEqual({
      title: 'scoring.quarantine.discardRoundTitle',
      description: 'scoring.quarantine.discardRoundBody',
      confirmLabel: 'scoring.quarantine.discardConfirm',
      cancelLabel: 'common.cancel',
      danger: true,
    });
  });
});

describe('why a round press is held', () => {
  const API = 'the API’s own English';

  const held = (rejectedCode: string, kind?: 'round' | 'press' | 'exchange') => ({
    rejectedReason: API,
    rejectedCode,
    ...(kind ? { kind } : {}),
  });

  it.each([
    ['round_not_waiting', 'scoring.quarantine.roundNotWaiting'],
    ['round_not_open', 'scoring.quarantine.roundNotOpen'],
    ['bout_completed', 'scoring.quarantine.roundBoutCompleted'],
    ['clock_press_too_old', 'scoring.quarantine.roundTooOld'],
    ['scored_before_reset', 'scoring.quarantine.roundBeforeReset'],
    ['time_not_finished', 'scoring.level.refusedTimeNotFinished'],
    ['event_results_frozen', 'scoring.quarantine.eventOver'],
  ])('%s is said in the pad’s words, as of a round', (code, key) => {
    expect(heldReason(held(code, 'round'), t)).toBe(key);
  });

  it('the codes a round shares with a clock press and a hit keep THEIR words there', () => {
    expect(heldReason(held('bout_completed', 'press'), t)).toBe(
      'scoring.quarantine.pressBoutCompleted',
    );
    expect(heldReason(held('clock_press_too_old', 'press'), t)).toBe(
      'scoring.quarantine.pressTooOld',
    );
    expect(heldReason(held('scored_before_reset', 'exchange'), t)).toBe(
      'scoring.quarantine.scoredBeforeReset',
    );
    expect(heldReason(held('scored_before_reset'), t)).toBe('scoring.quarantine.scoredBeforeReset');
  });

  it('a round code on a row that is no round press keeps the server’s words', () => {
    expect(heldReason(held('round_not_waiting', 'exchange'), t)).toBe(API);
  });

  it.each(['round_not_waiting', 'round_not_open'])(
    'Retry is offered for %s: another device may close or open the round meanwhile',
    (code) => {
      expect(canSendAgain({ rejectedReason: '', rejectedCode: code })).toBe(true);
    },
  );
});

describe('the notice at the clock of a bout that holds a round press', () => {
  it('says a round action was refused, why, and that the bout waits behind it', () => {
    const held = { kind: 'round', rejectedReason: 'x', rejectedCode: 'round_not_waiting' } as const;

    expect(heldRowNotice(held, t)).toBe(
      'scoring.clock.roundHeld scoring.quarantine.roundNotWaiting scoring.clock.pressHeldWaits',
    );
  });

  it('keeps the words of a clock press and of an entry', () => {
    const why = { rejectedReason: 'x' };

    expect(heldRowNotice({ kind: 'press', ...why }, t)).toContain('scoring.clock.pressHeld ');
    expect(heldRowNotice({ kind: 'penalty', ...why }, t)).toContain('scoring.clock.entryHeld ');
    expect(heldRowNotice({ ...why }, t)).toContain('scoring.clock.entryHeld ');
  });
});
