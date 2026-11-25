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
const control = read('ProtestControl.tsx');
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

  // The aria-label replaces the visible text: it says the count too, over the limit when there is one.
  it('names the Fighter it records a protest for, and the count so far', () => {
    expect(button).toContain('const text = protestChipText(count, limit);');
    expect(tag).toContain(
      "aria-label={t('scoring.lice.protestButtonLabel', { fighter: fighterName, count: text })}",
    );
    expect(tag.slice(tag.lastIndexOf('/>'))).toContain('{text}');
  });

  it('has the touch size of the pad’s other buttons, and the hand of the history', () => {
    expect(tag).toContain('min-h-[44px]');
    expect(tag).toContain('<HandMark');
    expect(button).toContain(
      "import { HandMark, protestAtLimit, protestChipText } from '@myclash/ui';",
    );
  });

  it('is drawn with tokens only: no raw palette class, and the warning from the limit on', () => {
    expect(button).not.toMatch(
      /\b(?:bg|text|border)-(?:white|black|(?:red|blue|yellow|gray|green|amber|slate|zinc)-\d{2,3})\b/,
    );
    expect(button).not.toContain('raw-color-exempt');
    expect(button).toMatch(
      // 15%: the warning ink reads on its own wash up to there (D34, D41).
      /const tone = protestAtLimit\(count, limit\)\s+\? 'bg-warning\/15 text-warning border-warning'\s+: 'bg-surface text-foreground-secondary border-border';/,
    );
    expect(tag).toContain('rounded-lg border px-2.5');
    expect(tag).toContain('${tone}');
  });

  it('offers one button to each Fighter on a break screen', () => {
    const pair = button.slice(button.indexOf('export function ProtestPair'));
    expect(pair).toContain("(['red', 'blue'] as const).map((corner) =>");
    expect(pair).toContain('<ProtestButton');
    expect(pair).toContain('limit={limit}');
    expect(pair).toContain('size="dialog"');
  });
});

describe('the pad', () => {
  it('shows the button after the card chips, live on the bout’s protest rule', () => {
    const chips = column.indexOf('data-testid="card-chip"');
    expect(column.indexOf('<ProtestControl')).toBeGreaterThan(chips);
    expect(element(column, '<ProtestControl')).toContain('disabled={!protestLive || readOnly}');
    const chip = element(control, '<ProtestButton');
    expect(chip).toContain('count={scoring.protestCountFor(registrationId)}');
    expect(chip).toContain('limit={protestRules.limit}');
    expect(control).toContain('const protestRules = protestRulesOf(config.display);');
    expect(chip).toContain('disabled={disabled}');
    expect(chip).toContain('size="pad"');
  });

  // A completed bout whose result screen was closed shows the columns: the button is live there,
  // card entry is not, and the offer must keep to card entry.
  it('offers the penalty after the tap, only while the pad takes a card', () => {
    const tap = control.slice(control.indexOf('async function protest()'));
    const body = tap.slice(0, tap.indexOf('\n  }\n'));
    expect(body).toContain('const entry = await protestThenOffer({');
    expect(body).toContain('tap: () => onProtestTap(side),');
    expect(body).toContain('seen: seenProtests.current,');
    expect(body).toMatch(/^\s+cardEntryLive,$/m);
    expect(element(column, '<ProtestControl')).toContain('cardEntryLive={scoringEnabled}');
  });

  // The offer IS the confirmation: its yes gives the card of the list, through the column's one
  // card path, with no second question.
  it('gives the offered card at the yes, through the column’s card path', () => {
    expect(control).toMatch(
      /const offer = offered;\s+setOffered\(null\);\s+if \(offer\) onOfferAccepted\(offer\.entry\);/,
    );
    expect(element(column, '<ProtestControl')).toContain(
      'onOfferAccepted={(entry) => void submitPenalty(listedCard(entry))}',
    );
  });

  // The count after a tap is the drawn protests plus the written ones not drawn yet: the draw the
  // control tells it is the chip's own rows (`protestsOf`, the owner of the chip's count).
  it('tells the offer which protests the screen drew, from the chip’s own rows', () => {
    expect(control).toMatch(
      /const shownKey = protestsOf\(\{\s+server: scoring\.activeProtests,\s+pending: scoring\.pendingProtests,\s+sideId: registrationId,\s+\}\)/,
    );
    expect(control).toContain('const seenProtests = useRef(protestsSeen(matchId));');
    expect(control).toContain(
      'seenProtests.current = protestsShown(seenProtests.current, matchId, shown);',
    );
  });

  // The pad opens the next bout on the same screen: the protests seen are the bout's.
  it('starts the protests seen afresh when the bout changes', () => {
    expect(control).toContain('}, [matchId, shownKey]);');
  });

  it('taps through the page’s one tap: no column and no control builds its own', () => {
    expect(column).not.toContain('useProtestTap(');
    expect(column).not.toContain('protestTap(');
    expect(control).not.toContain('useProtestTap(');
    expect(element(column, '<ProtestControl')).toContain('onProtestTap={onProtestTap}');
    expect(view.split('useProtestTap(')).toHaveLength(2);
    expect(view.split('onProtestTap={tapProtest}')).toHaveLength(3);
    expect(view).toContain('onRecorded: moveSequenceOn,');
  });

  it('reads the running clock at the tap', () => {
    expect(view).toContain('clockTimeMs: () => clockAtTap(clockState),');
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

  it('is handed the protests by the page, with the Tournament’s limit', () => {
    expect(element(view, '<RoundBreakDialog')).toContain('protests={protestPair}');
    expect(view).toContain('limit: protestRulesOf(scoringConfig.display).limit,');
  });
});

describe('the result screen', () => {
  it('offers both Fighters’ buttons, counted from the server and the tablet', () => {
    const pair = element(result, '<ProtestPair');
    expect(pair).toContain('scoring.protestCountFor(');
    expect(pair).toContain('limit={protestRulesOf(props.scoringConfig.display).limit}');
    expect(pair).toContain('live={props.protestLive}');
    expect(pair).toContain('onTap={props.onProtest}');
  });

  it('never offers a card, nor does the round-break screen: the offer is the pad’s', () => {
    for (const screen of [result, dialogs, button]) {
      expect(screen).not.toContain('protestThenOffer');
      expect(screen).not.toContain('ProtestControl');
    }
  });

  it('keeps its history to the server’s rows: the waiting protests never reach it', () => {
    expect(timelineArgs(result)).toContain('protests: activeProtests,');
    expect(result).not.toContain('pendingProtests');
    const flow = result.slice(result.indexOf('buildBoutFlow({'));
    expect(flow.slice(0, flow.indexOf('})'))).not.toContain('protest');
  });
});
