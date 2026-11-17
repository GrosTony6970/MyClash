/**
 * The protest button on the pad, the round-break screen and the result screen:
 * the screens' side.
 *
 * web-staff has no React test setup, so the screens are read as text. These
 * pins hold the WIRING: one button component, on three screens, for both
 * Fighters; what each screen hands to the shared history. What a tap does is
 * held in a browser (`tests/a11y/pad-protest-*.spec.ts`).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (name: string) => readFileSync(join(__dirname, name), 'utf8');
const button = read('ProtestButton.tsx');
const column = read('ScoringColumn.tsx');
const dialogs = read('MatchPauseDialogs.tsx');
const result = read('MatchResultOverlay.tsx');
const centre = read('ScoringCenterControls.tsx');
const view = read('MatchView.tsx');

/** One self-closing JSX element of a screen, from its tag to its `/>`. */
function element(source: string, tag: string): string {
  const start = source.indexOf(tag);
  expect(start, tag).toBeGreaterThanOrEqual(0);
  return source.slice(start, source.indexOf('/>', start));
}

/** The argument object of the screen's one `buildUnifiedTimeline` call. */
function timelineArgs(source: string): string {
  const start = source.indexOf('buildUnifiedTimeline({');
  expect(start).toBeGreaterThan(0);
  return source.slice(start, source.indexOf('})', start));
}

describe('the protest button', () => {
  const tag = button.slice(button.indexOf('<button'), button.indexOf('</button>'));

  it('is a button, found by its test id, that says its count', () => {
    expect(tag).toContain('type="button"');
    expect(tag).toContain('data-testid="protest-chip"');
    expect(tag).toContain('data-count={count}');
    expect(tag).toContain('disabled={disabled}');
    expect(tag).toContain('onClick={onTap}');
  });

  // The aria-label replaces the visible text: it says the count too.
  it('names the Fighter it records a protest for, and the count so far', () => {
    expect(tag).toContain(
      "aria-label={t('scoring.lice.protestButtonLabel', {\n        fighter: fighterName,\n        count: String(count),\n      })}",
    );
  });

  it('has the touch size of the pad’s other buttons, and the hand of the history', () => {
    expect(tag).toContain('min-h-[44px]');
    expect(tag).toContain('<HandMark');
    expect(button).toContain("import { HandMark } from '@myclash/ui';");
  });

  it('is drawn with tokens only: no raw palette class', () => {
    expect(button).not.toMatch(
      /\b(?:bg|text|border)-(?:white|black|(?:red|blue|yellow|gray|green|amber|slate|zinc)-\d{2,3})\b/,
    );
    expect(button).not.toContain('raw-color-exempt');
    expect(tag).toContain('bg-surface text-foreground-secondary border border-border');
  });

  it('offers one button to each Fighter on a break screen', () => {
    const pair = button.slice(button.indexOf('export function ProtestPair'));
    expect(pair).toContain("(['red', 'blue'] as const).map((corner) =>");
    expect(pair).toContain('<ProtestButton');
    expect(pair).toContain('size="dialog"');
  });
});

describe('the pad', () => {
  it('shows the button after the card chips, live on the bout’s protest rule', () => {
    const chips = column.indexOf('data-testid="card-chip"');
    const chip = element(column, '<ProtestButton');
    expect(column.indexOf('<ProtestButton')).toBeGreaterThan(chips);
    expect(chip).toContain('count={scoring.protestCountFor(registrationId)}');
    expect(chip).toContain('disabled={!protestLive || readOnly}');
    expect(chip).toContain('size="pad"');
  });

  it('taps through the one tap handler, reading the clock at the tap', () => {
    expect(column).toContain('useProtestTap({');
    expect(column).toContain('clockTimeMs: protestClockMs,');
    expect(column).toContain('onRecorded: onPenaltyRecorded');
  });

  it('reads the running clock at the tap, one getter for every protest button', () => {
    expect(view).toContain('const protestClockMs = () => clockAtTap(clockState);');
    expect(view.split('protestClockMs={protestClockMs}')).toHaveLength(3);
    expect(view).toContain('clockTimeMs: protestClockMs,');
  });

  it('is told the bout’s protest rule by the page: both columns and the result screen', () => {
    const rule = view.slice(view.indexOf('const protestLive = protestButtonLive({'));
    expect(rule.slice(0, rule.indexOf('});'))).toMatch(
      /boutStatus,\s+lockedAt: match\.lockedAt \?\? null,\s+eventOver: match\.eventOver,?\s*$/,
    );
    expect(view.split('protestLive={protestLive}')).toHaveLength(4);
  });

  it('hands the server’s protests and the waiting ones to the history', () => {
    expect(timelineArgs(centre)).toContain('protests: [...activeProtests, ...pendingProtests],');
  });
});

describe('the round-break screen', () => {
  it('offers both Fighters’ buttons, after its own buttons for the focus', () => {
    const dialog = dialogs.slice(dialogs.indexOf('export function RoundBreakDialog'));
    expect(dialog).toContain('<ProtestPair {...protests} />');
    // The Modal focuses its first button: "Start round" must stay first, or Space records a protest.
    const footer = dialog.slice(dialog.indexOf('footer={'));
    expect(footer.indexOf('<RoundBreakButtons')).toBeLessThan(footer.indexOf('<ProtestPair'));
  });

  it('is handed the protests by the page', () => {
    expect(element(view, '<RoundBreakDialog')).toContain('protests={protestPair}');
  });
});

describe('the result screen', () => {
  it('offers both Fighters’ buttons, counted from the server and the tablet', () => {
    const pair = element(result, '<ProtestPair');
    expect(pair).toContain('scoring.protestCountFor(');
    expect(pair).toContain('live={props.protestLive}');
    expect(pair).toContain('onTap={props.onProtest}');
  });

  it('keeps its history to the server’s rows: the waiting protests never reach it', () => {
    expect(timelineArgs(result)).toContain('protests: activeProtests,');
    expect(result).not.toContain('pendingProtests');
    const flow = result.slice(result.indexOf('buildBoutFlow({'));
    expect(flow.slice(0, flow.indexOf('})'))).not.toContain('protest');
  });
});
