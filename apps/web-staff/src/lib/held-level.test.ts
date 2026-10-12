/**
 * A step of a level bout the server refused ("Extra time 60s", "Sudden
 * death"), in the inbox and at the clock: which step, why it is held, and what
 * its discard does.
 *
 * A step is no hit, no clock press and no round press. With no words of its
 * own a held "Extra time 60s" would read "Queued entry" with "Discard this
 * hit?", or "this round action".
 */
import { describe, expect, it } from 'vitest';
import { canSendAgain } from '../offline/can-send-again';
import { discardQuestion, heldLevelLabel, heldRowNotice, heldWhoLine } from './held-hit';
import { heldReason } from './refusal-copy';

const t = (key: string, values?: Record<string, string | number>) =>
  values ? `${key} ${JSON.stringify(values)}` : key;

describe('the label of a held step', () => {
  it('is the words of its button', () => {
    expect(heldLevelLabel({ step: 0, kind: 'extra_time', seconds: 60 }, t)).toBe(
      'scoring.level.playExtraTime {"seconds":60}',
    );
    expect(heldLevelLabel({ step: 1, kind: 'sudden_death' }, t)).toBe(
      'scoring.level.playSuddenDeath',
    );
  });

  it('a row that names no step reads as an entry the pad cannot name', () => {
    expect(heldLevelLabel(undefined, t)).toBe('scoring.quarantine.typeUnknown');
  });
});

describe('who a held step is about', () => {
  it('is nobody: the label says which step', () => {
    expect(
      heldWhoLine({ kind: 'level', bout: { label: 'QF1', red: 'Ana', blue: 'Bo' } }, t),
    ).toBeNull();
  });
});

describe('the question before the discard of a step', () => {
  it('has its own words', () => {
    expect(discardQuestion({ kind: 'level' }, t)).toEqual({
      title: 'scoring.quarantine.discardLevelTitle',
      description: 'scoring.quarantine.discardLevelBody',
      confirmLabel: 'scoring.quarantine.discardConfirm',
      cancelLabel: 'common.cancel',
      danger: true,
    });
  });
});

describe('why a step is held', () => {
  const API = 'the API’s own English';
  const held = (rejectedCode: string, kind?: 'level' | 'round' | 'press' | 'exchange') => ({
    rejectedReason: API,
    rejectedCode,
    ...(kind ? { kind } : {}),
  });

  it.each([
    ['bout_not_level', 'scoring.quarantine.levelNotLevel'],
    ['level_step_not_pending', 'scoring.quarantine.levelStepNotPending'],
    ['time_not_finished', 'scoring.quarantine.levelTimeNotFinished'],
    ['round_not_open', 'scoring.quarantine.levelNotApplied'],
    ['round_awaits_advance', 'scoring.quarantine.levelNotApplied'],
    ['bout_completed', 'scoring.quarantine.levelNotApplied'],
    ['clock_press_too_old', 'scoring.quarantine.levelNotApplied'],
    ['scored_before_reset', 'scoring.quarantine.levelNotApplied'],
    ['pressed_before_reopen', 'scoring.quarantine.levelNotApplied'],
    ['event_results_frozen', 'scoring.quarantine.eventOver'],
    ['match_locked', 'scoring.quarantine.boutLocked'],
  ])('%s is said in the pad’s words, as of a step', (code, key) => {
    expect(heldReason(held(code, 'level'), t)).toBe(key);
  });

  it('the codes a step shares with other rows keep THEIR words there', () => {
    expect(heldReason(held('round_not_open', 'round'), t)).toBe('scoring.quarantine.roundNotOpen');
    expect(heldReason(held('bout_completed', 'press'), t)).toBe(
      'scoring.quarantine.pressBoutCompleted',
    );
    expect(heldReason(held('time_not_finished', 'press'), t)).toBe(
      'scoring.level.refusedTimeNotFinished',
    );
    expect(heldReason(held('scored_before_reset', 'exchange'), t)).toBe(
      'scoring.quarantine.scoredBeforeReset',
    );
  });

  it('a code of a step on a row that is no step keeps the server’s words', () => {
    expect(heldReason(held('bout_not_level', 'press'), t)).toBe(API);
    expect(heldReason(held('level_step_not_pending', 'round'), t)).toBe(API);
  });

  it.each(['bout_not_level', 'level_step_not_pending', 'time_not_finished'])(
    'no new send cures %s: Discard alone',
    (code) => {
      expect(canSendAgain({ rejectedReason: '', rejectedCode: code })).toBe(false);
    },
  );

  // A completed bout takes the step only after a Reopen, and the step is then
  // from before it. A round that waits, or another round: the step's round is over.
  it.each(['bout_completed', 'round_awaits_advance', 'round_not_open'])(
    'no new send cures %s for a STEP; a clock press and a round press keep their Retry',
    (code) => {
      const held = (kind: string) => ({ rejectedReason: '', rejectedCode: code, kind });

      expect(canSendAgain(held('level'))).toBe(false);
      expect(canSendAgain(held('press'))).toBe(true);
      expect(canSendAgain(held('round'))).toBe(true);
    },
  );

  it.each(['match_locked', 'FORBIDDEN'])('a Retry can cure %s: it is offered', (code) => {
    expect(canSendAgain({ rejectedReason: '', rejectedCode: code, kind: 'level' })).toBe(true);
  });
});

describe('an End the server refused on a level board', () => {
  const held = (kind: 'press' | 'round') => ({
    kind,
    rejectedReason: 'Scores are level — play 60s of extra time to decide it',
    rejectedCode: 'level_at_time_unresolved',
  });

  it.each(['press', 'round'] as const)(
    'is said in the pad’s words for a %s row, not in the server’s English',
    (kind) => {
      expect(heldReason(held(kind), t)).toBe('scoring.quarantine.endLevel');
    },
  );
});

describe('the notice at the clock of a bout that holds a step', () => {
  it('says a step was refused, why, and that the bout waits behind it', () => {
    const held = { kind: 'level', rejectedReason: 'x', rejectedCode: 'bout_not_level' } as const;

    expect(heldRowNotice(held, t)).toBe(
      'scoring.clock.levelHeld scoring.quarantine.levelNotLevel scoring.clock.pressHeldWaits',
    );
  });
});
