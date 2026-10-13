/**
 * A clock press the server refused, in the inbox and on the bar: which button
 * it was, why it is held, what waits behind it, and what its discard does.
 *
 * A press is no hit. Before it had its own words, a held Start would have read
 * "Queued entry" with "Discard this hit?", and the bar "1 HIT NOT RECORDED".
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canSendAgain } from '../offline/can-send-again';
import {
  boutEntryCount,
  discardBoutQuestion,
  discardQuestion,
  heldPressLabel,
  heldRowNotice,
  heldWaitingLine,
  heldWhoLine,
} from './held-hit';
import { endRefusalMessage, heldReason } from './refusal-copy';
import { offersRetry, syncBarLabel, syncBarTone } from './sync-bar';

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

describe('the question before every entry of a bout is discarded', () => {
  it('is one question that says how many entries go, with both buttons worded', () => {
    expect(discardBoutQuestion(12, t)).toEqual({
      title: 'scoring.quarantine.discardBoutTitle {"count":12}',
      description: 'scoring.quarantine.discardBoutBody {"count":12}',
      confirmLabel: 'scoring.quarantine.discardConfirm',
      cancelLabel: 'common.cancel',
      danger: true,
    });
  });

  it('counts the rows of the bout the inbox holds and the rows that wait behind them', () => {
    const held = [{ matchId: 'm1' }, { matchId: 'm2' }, { matchId: 'm1' }];

    expect(boutEntryCount({ matchId: 'm1' }, held, 11)).toBe(13);
    expect(boutEntryCount({ matchId: 'm2' }, held, 1)).toBe(2);
  });

  it('is offered on a row with entries behind it, and goes through the engine', () => {
    // The pad's vitest mounts no component: the inbox is pinned as text.
    const inbox = readFileSync(join(__dirname, '..', 'components', 'QuarantineInbox.tsx'), 'utf8');
    expect(inbox).toContain('discardBout={waiting > 0}');
    expect(inbox).toContain('{discardBout && (');
    expect(inbox).toContain(
      'const count = boutEntryCount(entry, entries, behind.get(entry.id ?? -1) ?? 0);',
    );
    expect(inbox).toContain('if (!(await confirm(discardBoutQuestion(count, t)))) return;');
    expect(inbox).toContain('await run(entry.id, (id) => syncEngine.discardRejectedBout(id));');
    // 44px for a finger. Pinned here: in a browser the button beside it stretches this one.
    expect(inbox).toMatch(/const DISCARD_BUTTON =\s+'min-h-\[44px\] /);
    expect(inbox.match(/className=\{DISCARD_BUTTON\}/g)).toHaveLength(2);
  });

  it('the rounds read "a row is refused" with the queued rows, from one read', () => {
    // Read by two hooks, "none refused" reached a draw before "the rows are
    // gone": the screen closed a round on rows the Discard had just deleted.
    const read = (...path: string[]) => readFileSync(join(__dirname, '..', ...path), 'utf8');
    const hook = read('hooks', 'usePendingOutbox.ts');
    expect(hook).toContain("db.transaction('r', db.outbox, db.rejected, () =>");
    expect(hook).toContain('Promise.all([getPendingForMatch(matchId), heldRowsOf(matchId)]),');
    expect(hook).toContain('setHolds({ entries, held: refused.length > 0 });');
    expect(hook).toContain('}, [matchId, refreshKey, pendingCount, rejectedCount]);');
    expect(read('hooks', 'useMatchScoringData.ts')).toContain('args.syncRejectedCount,');
    const view = read('components', 'MatchView.tsx');
    expect(view).toContain('syncRejectedCount: syncState?.rejectedCount ?? 0,');
    expect(view).toContain('held: scoring.boutHeld,');
    expect(view).not.toContain('held: padClock.heldRows.length > 0');
  });
});

describe('why a press is held', () => {
  const API = 'the API’s own English';

  it.each([
    ['bout_completed', 'scoring.quarantine.pressBoutCompleted'],
    ['clock_press_out_of_order', 'scoring.quarantine.pressOutOfOrder'],
    ['clock_press_too_old', 'scoring.quarantine.pressTooOld'],
    ['pressed_before_reopen', 'scoring.quarantine.pressBeforeReopen'],
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

  it('is not offered for a press made before the bout was put back in play', () => {
    expect(canSendAgain({ rejectedReason: '', rejectedCode: 'pressed_before_reopen' })).toBe(false);
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

describe('the notice at the clock of a bout that holds a refused row', () => {
  const LOCKED = { rejectedReason: 'in English', rejectedCode: 'match_locked' };

  it('says a clock press was refused, why, and that the bout waits', () => {
    expect(heldRowNotice({ kind: 'press', ...LOCKED }, t)).toBe(
      `scoring.clock.pressHeld ${heldReason(LOCKED, t)} scoring.clock.pressHeldWaits`,
    );
  });

  it.each(['exchange', 'penalty', undefined] as const)(
    'says an entry was refused, for a row of kind %s: a hit and a card stop their bout too',
    (kind) => {
      expect(heldRowNotice({ kind, ...LOCKED }, t)).toBe(
        `scoring.clock.entryHeld ${heldReason(LOCKED, t)} scoring.clock.pressHeldWaits`,
      );
    },
  );

  it('says nothing while the inbox holds no row of the bout', () => {
    expect(heldRowNotice(undefined, t)).toBeNull();
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

// Operator, 2026-10-13. The server refused a hit; then the wifi drops. The bar
// went grey ("offline"), as if nothing needed the official.
describe('the bar over a refused entry with no network', () => {
  const grey = syncBarTone('offline', 0);
  const red = syncBarTone('error', 0);

  it('is red: a refused entry needs the official, with or without wifi', () => {
    expect(red).not.toBe(grey);
    expect(syncBarTone('offline', 1)).toBe(red);
  });

  it('is grey with no refused entry: a hall with no wifi is no fault', () => {
    expect(grey).toContain('text-muted');
  });

  it('says the refusal, and that there is no connection', () => {
    expect(syncBarLabel('offline', 1, t, 3, 0)).toBe(
      `⚠ ${t('scoring.lice.hitsRefused', { count: '1', plural: '' })} · scoring.lice.noConnectionToo`,
    );
    expect(syncBarLabel('offline', 2, t, 0, 1)).toBe(
      '⚠ scoring.lice.pressRefused · scoring.lice.noConnectionToo',
    );
  });

  it('offers no Retry: nothing can be sent', () => {
    expect(offersRetry('offline', { rejected: 1, sendable: 1, pending: 3 })).toBe(false);
  });

  // Operator, 2026-10-13: the same in read-only mode. It was grey.
  it('is red in read-only mode too, and says the refusal and "maintenance"', () => {
    expect(syncBarTone('maintenance', 1)).toBe(red);
    expect(syncBarLabel('maintenance', 1, t, 3, 0)).toBe(
      `⚠ ${t('scoring.lice.hitsRefused', { count: '1', plural: '' })} · scoring.lice.maintenanceToo`,
    );
    expect(syncBarLabel('maintenance', 2, t, 0, 1)).toBe(
      '⚠ scoring.lice.pressRefused · scoring.lice.maintenanceToo',
    );
  });

  it('read-only mode with no refused entry stays grey, with its own words', () => {
    expect(syncBarTone('maintenance', 0)).toBe(grey);
    expect(syncBarLabel('maintenance', 0, t, 3, 0)).toBe('● scoring.lice.maintenanceQueued');
  });

  // Nothing tells the pad that read-only mode ended: its Retry stays while a hit waits.
  it('keeps the Retry of read-only mode over a refused entry, while a hit waits', () => {
    expect(offersRetry('maintenance', { rejected: 1, sendable: 0, pending: 2 })).toBe(true);
    expect(offersRetry('maintenance', { rejected: 1, sendable: 1, pending: 0 })).toBe(false);
  });

  it('the bar hands the count of refused entries to its tone', () => {
    const bar = readFileSync(join(__dirname, '..', 'components', 'SyncBar.tsx'), 'utf8');
    expect(bar).toContain('${syncBarTone(phase, rejected)}');
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
