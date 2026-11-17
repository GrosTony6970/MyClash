import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING_CONFIG } from '@myclash/types';

import { HAND_PATHS } from './hand-mark';
import { MatchTimeline } from './MatchTimeline';
import { buildUnifiedTimeline } from '../utils/exchange-timeline';

/**
 * A protest is a row of the Match's history with no number.
 *
 * `UnifiedEvent.number` is `number | null`, and a template literal compiles
 * with a null in it: the row would print "#null" on the pad, the projector and
 * the public page, and `null === null` would light it as the chart's spotlight
 * whenever nothing is spotlit. The markup is what shows either, so it is what
 * this reads (`renderToStaticMarkup`: this package has no DOM test setup).
 */

const lucideRoot = dirname(createRequire(__filename).resolve('lucide-react/package.json'));

/** A translator that shows the key it is asked for. */
const say = (key: string) => `<${key}>`;

const events = buildUnifiedTimeline({
  exchanges: [
    {
      id: 'hit-1',
      sequence: 1,
      type: 'clean',
      voided: false,
      occurredAt: '2027-06-21T10:01:00.000Z',
      clockTimeMs: 5_000,
      scoringSide: 'red',
      scoreDelta: 1,
    },
  ],
  penalties: [],
  protests: [
    {
      id: 'protest-1',
      client_uuid: 'uuid-protest-1',
      match_id: 'match-1',
      registration_id: 'reg-blue',
      sequence: 1,
      round_number: 1,
      clock_time_ms: 9_000,
      occurred_at: '2027-06-21T10:02:00.000Z',
      voided: false,
    },
  ],
  redName: 'Ana Red',
  blueName: 'Bo Blue',
  redRegId: 'reg-red',
  blueRegId: 'reg-blue',
  t: say,
  config: DEFAULT_SCORING_CONFIG,
});

/** The `<li>` of each row, newest first. */
function rows(highlightNumber: number | null): string[] {
  const html = renderToStaticMarkup(
    <MatchTimeline events={events} highlightNumber={highlightNumber} t={say} />,
  );
  return html.split('<li').slice(1);
}

const protestRow = (all: string[]) => all.find((li) => li.includes('scoring.lice.eventRowProtest'));
const hitRow = (all: string[]) => all.find((li) => li.includes('Ana Red'));

describe('MatchTimeline — a protest row', () => {
  it('renders no # text and no data-event-number', () => {
    const row = protestRow(rows(null));
    expect(row).toBeDefined();
    // Text only: the side dot's inline colour is a hex, `#2563eb`.
    expect(row).not.toMatch(/>#/);
    expect(row).not.toContain('null');
    expect(row).not.toContain('data-event-number');
    expect(row).toContain('Bo Blue');
  });

  it('draws the hand in the row’s own colour, not an emoji', () => {
    const row = protestRow(rows(null))!;
    // The compact scale's icon slot: the token-coloured `text-warning`.
    expect(row).toMatch(/<svg[^>]*stroke="currentColor"[^>]*class="text-warning/);
    expect(row).toContain('aria-hidden="true"');
    for (const d of HAND_PATHS) expect(row).toContain(`d="${d}"`);
    expect(row).not.toContain('✋');
  });

  it('is lucide’s hand, the one the protest chips show', async () => {
    const icon = (await import(
      pathToFileURL(join(lucideRoot, 'dist', 'esm', 'icons', 'hand.mjs')).href
    )) as { __iconData: { node: [string, { d: string }][] } };
    expect(icon.__iconData.node.map(([, attrs]) => attrs.d)).toEqual([...HAND_PATHS]);
  });

  it('leaves the hit around it numbered', () => {
    const row = hitRow(rows(null));
    expect(row).toMatch(/>#(?:<!-- -->)?1</);
    expect(row).toContain('data-event-number="1"');
  });

  it('is never the spotlit row when nothing is spotlit', () => {
    // The compact scale's active row class (`rowActive`).
    for (const li of rows(null)) expect(li).not.toContain('rounded-md -mx-1 px-1');
  });

  it('still lets a numbered row be spotlit', () => {
    expect(hitRow(rows(1))).toContain('rounded-md -mx-1 px-1');
    expect(protestRow(rows(1))).not.toContain('rounded-md -mx-1 px-1');
  });
});

describe('MatchTimeline — the side dot', () => {
  // A black corner's dot was 1.72:1 on the dark pad, a white one 1.42:1 on a light one (D38).
  it('carries an edge ring, so a black or white corner still shows', () => {
    expect(hitRow(rows(null))).toMatch(
      /class="inline-block h-2 w-2 rounded-full flex-shrink-0 ring-1 ring-inset ring-foreground\/50"/,
    );
  });
});
