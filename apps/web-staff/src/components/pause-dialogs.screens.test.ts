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

  it('opens each one on the state it had', () => {
    expect(view).toContain('open={pendingResume !== null}');
    expect(view).toContain(
      "open={isBestOf && awaitingRoundAdvance && clockState?.status !== 'ended'}",
    );
  });
});

describe('the resume warning', () => {
  it('is the shared dialog, and Close leaves it', () => {
    expect(warning).toMatch(/<Modal\s+open=\{open\}\s+onClose=\{onClose\}/);
  });

  it('puts Close first, so the focus lands on it and a second Space restarts nothing', () => {
    const close = warning.indexOf("{t('scoring.result.close')}");
    const end = warning.indexOf("{t('scoring.resumeGuard.endMatch')}");
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
});

describe('the round-break screen', () => {
  it('is the shared dialog, and nothing dismisses it', () => {
    expect(dialogs).toContain('const staysOpen = () => {};');
    expect(roundBreak).toMatch(/<Modal\s+open=\{open\}\s+onClose=\{staysOpen\}/);
  });

  it('has one way out, the size of a finger', () => {
    expect(roundBreak.match(/<button/g)).toHaveLength(1);
    expect(roundBreak).toMatch(
      /onClick=\{busy \? undefined : onStart\}\s+className="min-h-\[44px\]/,
    );
  });

  it('keeps its button able to take the focus while a call runs', () => {
    expect(roundBreak).toContain('aria-disabled={busy}');
    expect(roundBreak).not.toMatch(/\sdisabled=/);
  });
});
