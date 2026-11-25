/**
 * A protest in the bout's list on the pad: the screens' side.
 *
 * web-staff has no React test setup, so the screens are read as text. These
 * pins hold the WIRING: which list each screen hands to the shared history,
 * and what the centre's "Exchanges: N" counts. The history's own rules (a
 * protest takes its place with no number) are held in `@myclash/ui`
 * (`exchange-timeline.test.ts`, `MatchTimeline.render.test.tsx`).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (name: string) => readFileSync(join(__dirname, name), 'utf8');
const centre = read('ScoringCenterControls.tsx');
const result = read('MatchResultOverlay.tsx');
const drawer = read('MatchCorrectionsDrawer.tsx');

/** The argument object of the screen's one `buildUnifiedTimeline` call. */
function timelineArgs(source: string): string {
  const start = source.indexOf('buildUnifiedTimeline({');
  expect(start).toBeGreaterThan(0);
  return source.slice(start, source.indexOf('})', start));
}

describe('the centre of the pad', () => {
  // What the centre hands the history (the server's protests and the waiting
  // ones) is pinned in `protest-chip.screens.test.ts`.
  it('counts hits and cards in "Exchanges: N", never a protest', () => {
    expect(centre).toContain(
      "const entriesCounted = events.filter((e) => e.kind !== 'protest').length;",
    );
    expect(centre).toContain("t('scoring.lice.exchangesCount', { count: String(entriesCounted) })");
  });

  it('keeps "Undo last entry" live while the list holds anything, a protest included', () => {
    expect(centre).toContain('disabled={events.length === 0 || undo.busy}');
  });
});

describe('the end-of-Match screen', () => {
  it('hands the server’s protests to the history, and none to the chart', () => {
    expect(timelineArgs(result)).toContain('protests: activeProtests,');
    const flow = result.slice(result.indexOf('buildBoutFlow({'));
    expect(flow.slice(0, flow.indexOf('})'))).not.toContain('protest');
  });
});

describe('the corrections drawer', () => {
  it('numbers its hits from the same history, protests in it', () => {
    expect(timelineArgs(drawer)).toContain('protests: activeProtests,');
  });
});

/**
 * A team's colour chip on the pad's history and flow legend (call 6): the wiring only. The chip
 * itself is held in `@myclash/ui` (`team-chip.render.test.tsx`).
 */
describe("a team bout's chip on the pad", () => {
  const view = read('MatchView.tsx');
  /** The JSX element that opens with `open`, up to its closing `/>`. */
  const element = (source: string, open: string) => {
    const start = source.indexOf(open);
    expect(start).toBeGreaterThan(0);
    return source.slice(start, source.indexOf('/>', start));
  };
  const coloursOfSides = ['redColour={redColour}', 'blueColour={blueColour}'];

  it('hands the bout’s team colours to the centre and to the end-of-Match screen', () => {
    for (const open of ['<ScoringCenterControls', '<MatchResultOverlay']) {
      expect(element(view, open)).toContain('redColour={match.redColour ?? null}');
      expect(element(view, open)).toContain('blueColour={match.blueColour ?? null}');
    }
  });

  it('hands them on to the history and the flow chart', () => {
    for (const [source, open] of [
      [centre, '<MatchTimeline'],
      [result, '<MatchTimeline'],
      [result, '<BoutFlowChart'],
    ] as const) {
      for (const prop of coloursOfSides) expect(element(source, open)).toContain(prop);
    }
  });
});

/**
 * A bout waiting for a Fighter (operator, 2026-11-24): the wiring only. The decision is
 * `sideMissing` (`lib/bout-sides.test.ts`); the behaviour is the browser story
 * `tests/a11y/pad-bout-waits-for-fighter.spec.ts`.
 */
describe('a bout waiting for a Fighter', () => {
  const view = read('MatchView.tsx');

  it('is asked once, of the bout on screen', () => {
    expect(view).toContain('const waitingForFighter = sideMissing(match);');
  });

  it('refuses a Start at the one door of the clock, forced or not', () => {
    const door = view.slice(view.indexOf('const onClockAction = useCallback('));
    const refusal = "if (action === 'start' && waitingForFighter) {";
    expect(door.indexOf(refusal)).toBeGreaterThan(0);
    expect(door.indexOf(refusal)).toBeLessThan(door.indexOf('!force &&'));
  });

  it('takes no hit or card, greys Start, and says why', () => {
    expect(view).toMatch(/!series\.awaitingStart &&\s+!waitingForFighter;/);
    expect(view).toContain('startBlocked={waitingForFighter}');
    expect(centre).toContain("(primary.action === 'start' && startBlocked)");
    expect(view).toContain("{t('pad.match.waitingForFighter')}");
  });

  it('greys the colour swap and the direct card of the drawer', () => {
    expect(view).toContain('sideMissing={waitingForFighter}');
    expect(drawer).toContain('disabled={disabled || sideMissing}');
    expect(drawer).toContain('disabled={busy || locked || sideMissing}');
  });
});
