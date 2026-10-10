/**
 * A clock press the server refused, in the inbox and on the bar: which button
 * it was, why it is held, what waits behind it, and what its discard does.
 *
 * A press is no hit. Before it had its own words, a held Start would have read
 * "Queued entry" with "Discard this hit?", and the bar "1 HIT NOT RECORDED".
 */
import { describe, expect, it } from 'vitest';
import { canSendAgain } from '../offline/can-send-again';
import { discardQuestion, heldPressLabel, heldWaitingLine, heldWhoLine } from './held-hit';
import { endRefusalMessage, heldReason } from './refusal-copy';
import { syncBarLabel } from './sync-bar';

const t = (key: string, values?: Record<string, string | number>) =>
  values ? `${key} ${JSON.stringify(values)}` : key;

describe('the label of a held press', () => {
  it.each([
    ['start', 'scoring.quarantine.typePressStart'],
    ['halt', 'scoring.quarantine.typePressHalt'],
    ['resume', 'scoring.quarantine.typePressResume'],
    ['end', 'scoring.quarantine.typePressEnd'],
  ] as const)('names the button: %s', (action, key) => {
    expect(heldPressLabel(action, t)).toBe(key);
  });

  it('a row that names no button reads as an entry the pad cannot name', () => {
    expect(heldPressLabel(undefined, t)).toBe('scoring.quarantine.typeUnknown');
  });
});

describe('who a held press is about', () => {
  it('is nobody: the label says which button', () => {
    const press = { kind: 'press', bout: { label: 'P1', red: 'Ana', blue: 'Bo' } } as const;

    expect(heldWhoLine(press, t)).toBeNull();
  });
});

describe('what waits behind a held press', () => {
  it('says nothing with no row behind it', () => {
    expect(heldWaitingLine(0, t)).toBeNull();
  });

  it('has its own sentence for one row: `t()` has no plural', () => {
    expect(heldWaitingLine(1, t)).toBe('scoring.quarantine.pressWaitingOne');
  });

  it('counts the rows', () => {
    expect(heldWaitingLine(4, t)).toBe('scoring.quarantine.pressWaitingMany {"count":4}');
  });
});

describe('the question before a discard', () => {
  it('of a hit says a scored hit is deleted', () => {
    expect(discardQuestion({ kind: 'exchange' }, t)).toEqual({
      title: 'scoring.quarantine.discardTitle',
      description: 'scoring.quarantine.discardBody',
      confirmLabel: 'scoring.quarantine.discardConfirm',
      cancelLabel: 'common.cancel',
      danger: true,
    });
    // A row from before the queue knew kinds is a hit.
    expect(discardQuestion({}, t).title).toBe('scoring.quarantine.discardTitle');
    expect(discardQuestion({ kind: 'penalty' }, t).title).toBe('scoring.quarantine.discardTitle');
  });

  it('of a press says what it frees, and names both buttons in the reader’s language', () => {
    expect(discardQuestion({ kind: 'press' }, t)).toEqual({
      title: 'scoring.quarantine.discardPressTitle',
      description: 'scoring.quarantine.discardPressBody',
      confirmLabel: 'scoring.quarantine.discardConfirm',
      cancelLabel: 'common.cancel',
      danger: true,
    });
  });
});

describe('why a press is held', () => {
  const API = 'the API’s own English';

  it.each([
    ['bout_completed', 'scoring.quarantine.pressBoutCompleted'],
    ['clock_press_out_of_order', 'scoring.quarantine.pressOutOfOrder'],
    ['clock_press_too_old', 'scoring.quarantine.pressTooOld'],
    ['round_awaits_advance', 'scoring.rounds.startNextRoundFirst'],
    ['time_not_finished', 'scoring.level.refusedTimeNotFinished'],
    ['event_results_frozen', 'scoring.quarantine.eventOver'],
    ['scored_before_reset', 'scoring.quarantine.scoredBeforeReset'],
    ['match_locked', 'scoring.quarantine.boutLocked'],
  ])('%s is said in the pad’s words', (code, key) => {
    expect(heldReason({ rejectedReason: API, rejectedCode: code }, t)).toBe(key);
  });

  it('keeps the server’s words for a code the pad does not know, and for none', () => {
    expect(heldReason({ rejectedReason: API, rejectedCode: 'constructor' }, t)).toBe(API);
    expect(heldReason({ rejectedReason: API }, t)).toBe(API);
  });
});

describe('a held press and Retry', () => {
  it('is not offered for a press made more than a day before its send', () => {
    expect(canSendAgain({ rejectedReason: '', rejectedCode: 'clock_press_too_old' })).toBe(false);
    expect(canSendAgain({ rejectedReason: '', rejectedCode: 'scored_before_reset' })).toBe(false);
  });

  it.each(['time_not_finished', 'level_at_time_unresolved'])(
    'is not offered for an End the server judged too early (%s): it is judged the same again',
    (code) => {
      expect(canSendAgain({ rejectedReason: '', rejectedCode: code })).toBe(false);
    },
  );

  it('is offered for the others', () => {
    expect(canSendAgain({ rejectedReason: '', rejectedCode: 'clock_press_out_of_order' })).toBe(
      true,
    );
    expect(canSendAgain({ rejectedReason: '' })).toBe(true);
  });
});

describe('the bar over a held press', () => {
  it('says the press was refused and its match waits, whatever else is held', () => {
    expect(syncBarLabel('error', 1, t, 2, 1)).toBe('⚠ scoring.lice.pressRefused');
    expect(syncBarLabel('error', 3, t, 0, 1)).toBe('⚠ scoring.lice.pressRefused');
  });

  it('keeps its words for held hits when no press is held', () => {
    expect(syncBarLabel('error', 1, t, 0, 0)).toContain('scoring.lice.hitsRefused');
    expect(syncBarLabel('error', 0, t, 1, 0)).toBe('⚠ scoring.lice.syncError');
  });

  it('does not reword another state: a session that ended is said first', () => {
    expect(syncBarLabel('signed-out', 1, t, 1, 1)).toBe('⚠ scoring.lice.sessionEnded');
    expect(syncBarLabel('offline', 0, t, 1, 1)).toBe('● scoring.lice.offlineQueued');
  });
});

describe('why the pad itself does not end a bout', () => {
  it('a level bout with time left: keep fighting', () => {
    expect(endRefusalMessage({ reason: 'time_not_finished' }, t)).toBe(
      'scoring.level.refusedTimeNotFinished',
    );
  });

  it('a level bout at its time: the remedy the phase names', () => {
    expect(
      endRefusalMessage({ reason: 'level', step: { kind: 'extra_time', seconds: 60 } }, t),
    ).toBe('scoring.level.refusedExtraTime {"seconds":60}');
    expect(endRefusalMessage({ reason: 'level', step: { kind: 'sudden_death' } }, t)).toBe(
      'scoring.level.refusedSuddenDeath',
    );
  });

  it('a spent chain is sudden death, which is live', () => {
    expect(endRefusalMessage({ reason: 'level', step: null }, t)).toBe(
      'scoring.level.refusedSuddenDeath',
    );
  });
});
