/**
 * A clock press acts at once and goes through the tablet's queue (operator,
 * 2026-10-10): the screens' side.
 *
 * web-staff has no React test setup, so the screens are read as text. These
 * pins hold the WIRING only. The rules are `offline/pad-clock.test.ts`,
 * `offline/sync.press.test.ts` and `end-guard.test.ts`; a live page proves
 * what the official sees (`tests/a11y/pad-clock-on-tablet.spec.ts`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (...path: string[]) => readFileSync(join(__dirname, '..', ...path), 'utf8');
const view = read('components', 'MatchView.tsx');
const controls = read('components', 'ScoringCenterControls.tsx');
const overlay = read('components', 'MatchResultOverlay.tsx');
const hook = read('hooks', 'usePadClock.ts');

describe('a press of the clock', () => {
  it('is written on the tablet and sent behind, as a hit is', () => {
    expect(view).toMatch(
      /const written = await writeHit\(\s+async \(\) => \{\s+await queuePress\(\{ matchId: match\.id, action, bout, endScore \}\);\s+\},\s+syncEngine,\s+clockPressed,\s+\);/,
    );
    expect(view).toContain(
      "if (written === 'not_saved') setClockError(t('scoring.lice.hitNotSaved'));",
    );
  });

  it('waits for the server only when it is a Reopen or a Reset', () => {
    expect(view).toContain(
      "if (action === 'reopen' || action === 'reset_clock') await askServerClock(action);\n      else await pressClock(action, endScore);",
    );
    // One POST to the clock's door in the screen: the Reopen and the Reset.
    expect(view.match(/\/clock`, \{\s+method: 'POST'/g)).toHaveLength(1);
    expect(view).toMatch(
      /const askServerClock = useCallback\(\s+async \(action: 'reopen' \| 'reset_clock'\)/,
    );
  });

  it('does not grey the clock’s buttons: only a Reopen or a Reset is waited for', () => {
    expect(view.match(/setClockLoading\(true\)/g)).toHaveLength(1);
    const pressClock = view.slice(
      view.indexOf('const pressClock = useCallback('),
      view.indexOf('const askServerClock = useCallback('),
    );
    expect(pressClock).not.toContain('setClockLoading');
    expect(pressClock).not.toContain('apiRequest');
  });
});

describe('the clock on the screen', () => {
  it('is the pad’s clock: the server’s answer and the presses the tablet holds', () => {
    expect(view).toContain('const clockState: ClockState | null = padClock.clock;');
    expect(view).not.toContain('setClockState');
    expect(hook).toContain('() => padClock(args.matchId, server, presses, sent),');
  });

  it('reads the queue again at once after a press of this screen', () => {
    expect(hook).toContain('}, [matchId, refreshKey, pendingCount, rejectedCount, pressTick]);');
    expect(hook).toContain(
      'const pressed = useCallback(() => setPressTick((tick) => tick + 1), []);',
    );
  });

  it('drops a read of the server’s clock that a press’s answer overtook', () => {
    expect(hook).toContain('const before = pressAnswers.current;');
    expect(hook).toContain('if (pressAnswers.current !== before) return;');
    expect(hook).toContain('pressAnswers.current += 1;');
    // The press that answer is of leaves the fold: the queue still lists it for a moment.
    expect(hook).toContain('setSent((before) => new Set(before).add(press.clientUuid));');
  });

  it('opens the tablet’s copy of the clock only when there is no network, and never over an answer', () => {
    expect(hook).toMatch(
      /=== 'offline'\) \{[^}]*const kept = await keptClock\(matchId\)\.catch\(\(\) => null\);\s+if \(kept\) setAnswered\(\(now\) => \(now\?\.matchId === matchId \? now : \{ matchId, clock: kept \}\)\);/,
    );
  });

  it('does not show the clock or the presses of the bout before this one', () => {
    expect(hook).toContain('const server = answered?.matchId === matchId ? answered.clock : null;');
    expect(hook).toContain('() => rows.presses.filter((row) => row.matchId === matchId),');
  });
});

describe('the Space key', () => {
  it('presses nothing on a locked bout, which shows no clock button', () => {
    expect(view).toMatch(
      /if \(drawerOpen\) return;\s+\/\/ A locked bout shows no clock button: the key presses none either\.\s+if \(match\.lockedAt\) return;/,
    );
  });
});

describe('the scoring buttons', () => {
  it('follow the bout’s status on the pad, not the server’s row alone', () => {
    expect(view).toContain(
      "const boutStatus = boutStatusOnPad(match.status, clockState?.status ?? 'idle');",
    );
    expect(view).toMatch(
      /const scoringEnabled =\s+\(boutStatus === 'running' \|\| boutStatus === 'paused'\) &&/,
    );
  });
});

describe('"End match" on the tablet', () => {
  it('asks the pad’s own rule first, from every End of the screen', () => {
    expect(view).toContain("else if (action === 'end') endMatch();");
    // A best-of bout is not judged here: the server ends its round or its series.
    expect(view).toMatch(/const refused = isBestOf\s+\? null\s+: endRefusedOnPad\(\{/);
    expect(view).toContain('if (refused) setClockError(endRefusalMessage(refused, t));');
    // The End carries the score it is pressed on, for the result screen.
    expect(view).toContain(
      "else void onClockAction('end', false, { red: redScore, blue: blueScore });",
    );
    // The controls, the resume warning and the early-End question: no other End.
    expect(view.match(/onClockAction\('end'/g)).toHaveLength(1);
    expect(view.match(/endMatch\(\);/g)).toHaveLength(3);
  });

  it('judges the score on the screen, the tablet’s unsent hits included', () => {
    expect(view).toMatch(/endRefusedOnPad\(\{[^}]*score: \{ redScore, blueScore \},/);
    expect(view).toContain('const redScore = match.redScore + provisional.red;');
  });

  it('shows the tablet’s own result until the server’s row says completed, and says so', () => {
    expect(view).toContain(
      "const unconfirmed = resultUnconfirmed(match.status, clockState?.status ?? 'idle');",
    );
    // The score the End was pressed on: the score on screen moves while the queue goes out.
    expect(view).toContain(
      'const ownResult = tabletResult(padClock.endScore, { red: redScore, blue: blueScore });',
    );
    expect(view).toContain('unconfirmed={unconfirmed}');
    expect(view).toContain('redScore={unconfirmed ? ownResult.red : match.redScore}');
    expect(view).toContain('blueScore={unconfirmed ? ownResult.blue : match.blueScore}');
    expect(view).toContain(
      'winnerRegistrationId={unconfirmed ? null : (match.winnerRegistrationId ?? null)}',
    );
    expect(hook).toContain(
      'setRows((before) => ({ presses, held, endScore: endScoreOf(presses, before.endScore) }));',
    );
    expect(hook).toContain(
      'const endScore = rows.endScore?.matchId === matchId ? rows.endScore : null;',
    );
    expect(overlay).toContain('{props.unconfirmed && <NotConfirmed />}');
    expect(overlay).toContain('data-testid="match-result-unconfirmed"');
  });
});

describe('what needs the network while presses wait', () => {
  it('Reopen and Reset wait until the queue has sent the bout’s presses', () => {
    // A press the inbox holds counts too: the rows of the bout wait behind it.
    expect(view).toContain(
      'pressesWaiting={padClock.pressesWaiting > 0 || padClock.heldPresses.length > 0}',
    );
    expect(controls).toContain(
      "disabled={clockLoading || (primary.action === 'reopen' && pressesWaiting)}",
    );
    expect(controls).toContain('disabled={clockLoading || pressesWaiting}');
  });

  it('so do the end of a round and a level bout’s remedy, which the server answers too', () => {
    expect(controls).toContain(
      'disabled={clockLoading || roundBusy || (isBestOf && pressesWaiting)}',
    );
    expect(controls).toContain('disabled={clockLoading || roundBusy || pressesWaiting}');
  });
});

describe('a row of the bout the server refused', () => {
  it('is said at the clock, as an alert, with its reason and the way out', () => {
    // A press, a hit or a card: the oldest held row of the bout (`heldRowNotice`).
    expect(view).toContain('const heldPressNotice = heldRowNotice(padClock.heldRows[0], t);');
    expect(view).toContain('heldPressNotice={heldPressNotice}');
    // The bar offers Retry for what a send can try, not for the rows that wait behind it.
    expect(read('components', 'SyncBar.tsx')).toContain('pending={syncState?.freeCount ?? 0}');
    expect(controls).toMatch(
      /\{heldPressNotice && \(\s+<p\s+role="alert"\s+data-testid="clock-press-held"/,
    );
  });
});
