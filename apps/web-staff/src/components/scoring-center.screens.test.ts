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
  it('hands the server’s protests to the history', () => {
    expect(timelineArgs(centre)).toContain('protests: activeProtests,');
  });

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
