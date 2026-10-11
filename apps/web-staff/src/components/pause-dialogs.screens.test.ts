/**
 * The round-break screen and the resume warning are real dialogs: the screens'
 * side.
 *
 * Between two rounds the screen says "Round 1 complete". It was a plain `div`,
 * and the Space bar asks the page for a dialog before it touches the clock: it
 * found none, and resumed the clock behind the screen while nobody fought.
 *
 * web-staff has no React test setup, so the screens are read as text. These
 * pins hold the WIRING only; a live page proves what Space does
 * (`tests/a11y/pad-space-behind-dialogs.spec.ts`).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (name: string) => readFileSync(join(__dirname, name), 'utf8');
const view = read('MatchView.tsx');
const dialogs = read('MatchPauseDialogs.tsx');
const warning = dialogs.slice(
  dialogs.indexOf('export function ResumeGuardDialog('),
  dialogs.indexOf('export function RoundBreakDialog('),
);
const roundBreak = dialogs.slice(dialogs.indexOf('export function RoundBreakDialog('));
const earlyEnd = dialogs.slice(
  dialogs.indexOf('export function EndEarlyDialog('),
  dialogs.indexOf('interface ResumeGuardDialogProps'),
);

describe('the bout screen', () => {
  it('draws no overlay of its own', () => {
    expect(view).not.toContain('fixed inset-0');
    expect(view).toContain('<ResumeGuardDialog');
    expect(view).toContain('<RoundBreakDialog');
  });

  it('asks the page for a dialog before Space touches the clock', () => {
    expect(view).toContain(
      'if (document.querySelector(\'[role="dialog"][aria-modal="true"]\')) return;',
    );
  });

  it('puts the Space listener on the window before the paint: a key is never judged by the clock from before', () => {
    expect(view).toMatch(
      /useLayoutEffect\(\(\) => \{\s+function onKey\(e: KeyboardEvent\) \{[\s\S]+?window\.addEventListener\('keydown', onKey\);\s+return \(\) => window\.removeEventListener\('keydown', onKey\);\s+\}, \[boutClock\?\.status, drawerOpen, match\.lockedAt, onClockAction\]\);/,
    );
  });

  it('reads the bout again when the server refuses a Reopen or a Reset, so a late tablet catches up', () => {
    expect(view).toMatch(
      /method: 'POST',\s+body: \{ action \},\s+\}\);\s+if \(!result\.ok\) \{[^}]*onRefresh\(\);\s+throw new Error\(refusalMessage\(result, t, 'scoring\.clock\.actionFailed'\)/,
    );
  });

  it('opens each one on the state it had', () => {
    expect(view).toContain('open={pendingResume !== null}');
    // The round view's "a round waits for Start", the server's or the tablet's.
    expect(view).toContain(
      "open={isBestOf && series.awaitingStart && boutClock?.status !== 'ended'}",
    );
  });
});

describe('the resume warning', () => {
  it('is the shared dialog, and Close leaves it', () => {
    expect(warning).toMatch(/<Modal\s+open=\{open\}\s+onClose=\{onClose\}/);
  });

  it('puts Close first, so the focus lands on it and a second Space restarts nothing', () => {
    const close = warning.indexOf("{t('scoring.result.close')}");
    const end = warning.indexOf("'scoring.resumeGuard.endMatch')}");
    const restart = warning.indexOf("{t('scoring.resumeGuard.continueAnyway')}");
    expect(close).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(close);
    expect(restart).toBeGreaterThan(end);
    // The first button does what it says.
    expect(warning).toMatch(/<>\s+<button\s+type="button"\s+onClick=\{onClose\}/);
  });

  it('has three buttons the size of a finger', () => {
    expect(warning.match(/<button/g)).toHaveLength(3);
    expect(warning.match(/min-h-\[44px\]/g)).toHaveLength(3);
  });

  it('names its End by what it ends: the round of a best-of bout, the bout of any other', () => {
    expect(warning).toContain(
      "{t(endsRound ? 'scoring.rounds.endRound' : 'scoring.resumeGuard.endMatch')}",
    );
    // Its sentence asks the same thing as its button.
    expect(warning).toContain(
      "{t(endsRound ? 'scoring.resumeGuard.messageRound' : 'scoring.resumeGuard.message')}",
    );
    expect(view).toMatch(
      /<ResumeGuardDialog\s+open=\{pendingResume !== null\}\s+endsRound=\{isBestOf\}/,
    );
  });

  it('ends the round of a best-of bout as the "End round" button does, and no bout', () => {
    expect(view).toMatch(
      /onEnd=\{\(\) => \{\s+setPendingResume\(null\);\s+if \(isBestOf\) \{\s+rounds\.endRound\(\);\s+\} else \{\s+endMatch\(\);\s+\}/,
    );
  });
});

describe('the question on an early End', () => {
  it('is asked by the controls, and not by the resume warning', () => {
    expect(view).toContain('onClockAction={onControlsClockAction}');
    expect(view).toContain('<EndEarlyDialog\n        open={pendingEnd}');
    // The warning's own End asks nothing: it is already the answer to a question.
    expect(view.match(/setPendingEnd\(true\)/g)).toHaveLength(1);
    expect(view).toMatch(/onEndMatch=\{\(\) => \{\s+setPendingEnd\(false\);\s+endMatch\(\);/);
  });

  it('is the shared dialog, and Close leaves it', () => {
    expect(earlyEnd).toMatch(/<Modal\s+open=\{open\}\s+onClose=\{onClose\}/);
  });

  it('puts Close first, so a Space after the slip ends nothing', () => {
    const close = earlyEnd.indexOf("{t('scoring.result.close')}");
    const end = earlyEnd.indexOf("{t('scoring.clock.endMatch')}");
    expect(close).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(close);
    expect(earlyEnd).toMatch(/<>\s+<button\s+type="button"\s+onClick=\{onClose\}/);
  });

  it('has two buttons the size of a finger', () => {
    expect(earlyEnd.match(/<button/g)).toHaveLength(2);
    expect(earlyEnd.match(/min-h-\[44px\]/g)).toHaveLength(2);
  });
});

describe('the round-break screen', () => {
  it('is the shared dialog, and nothing dismisses it', () => {
    expect(dialogs).toContain('const staysOpen = () => {};');
    expect(roundBreak).toMatch(/<Modal\s+open=\{open\}\s+onClose=\{staysOpen\}/);
  });

  it('has two buttons the size of a finger, and "Start round" is the first: the focus lands on it', () => {
    expect(roundBreak.match(/<button/g)).toHaveLength(2);
    expect(roundBreak.match(/min-h-\[44px\]/g)).toHaveLength(2);
    expect(roundBreak).toMatch(
      /<>\s+<button\s+type="button"\s+data-testid="start-next-round"\s+onClick=\{onStart\}\s+className="min-h-\[44px\]/,
    );
  });

  it('keeps its button able to take the focus: "Start round" waits for no call', () => {
    expect(roundBreak).not.toMatch(/disabled/);
  });

  it('says so when the tablet closed the round, under the score', () => {
    const score = roundBreak.indexOf('{redScore} – {blueScore}');
    const line = roundBreak.indexOf('{unconfirmed && <ClosedOnTablet />}');
    expect(score).toBeGreaterThan(0);
    expect(line).toBeGreaterThan(score);
    expect(dialogs).toMatch(
      /function ClosedOnTablet\(\) \{[\s\S]{0,80}<p\s+role="status"\s+data-testid="round-closed-on-tablet"[^>]*>\s+\{t\('scoring\.rounds\.closedOnTablet'\)\}/,
    );
    expect(view).toContain("unconfirmed={closedRound?.by === 'tablet'}");
  });
});
