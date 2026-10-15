import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { MatchCard } from './MatchCard';
import { BracketHighlightContext } from './highlight-context';
import type { BracketSlotData } from './types';

/**
 * Which bracket cards a piste operator may open.
 *
 * The scoring app's piste screen sets `highlightLiceId`, and that scopes the
 * whole bracket: this Lice's cards are ringed and live, every other card is
 * dimmed and inert. The rule is not cosmetic — the match list and the pool
 * table on that same screen already refuse to open another piste's bout,
 * because a tap that opens someone else's pad mid-event is how a bout gets
 * recorded twice.
 *
 * The last test is the one that earns its keep. Admin sets NO `highlightLiceId`
 * and depends on empty slots staying clickable to open its override modal, so a
 * well-meaning "cards without a match should never be clickable" would break a
 * flow in a different app with nothing else to catch it.
 *
 * `renderToStaticMarkup` rather than a DOM: `role` and the dim class are both in
 * the markup, and this package has no RTL — see `sortable-header-render.test.ts`.
 */

const MINE = 'lice-mine';
const THEIRS = 'lice-theirs';

function slot(over: Partial<BracketSlotData> = {}): BracketSlotData {
  return {
    id: 'slot-1',
    round: 1,
    position: 0,
    redFighterName: 'Marie Dubois',
    blueFighterName: 'Jean Biras',
    redScore: 6,
    blueScore: 4,
    status: 'completed',
    matchId: 'match-1',
    liceId: MINE,
    ...over,
  };
}

function markup(over: Partial<BracketSlotData>, highlightLiceId: string | null) {
  return renderToStaticMarkup(
    <BracketHighlightContext.Provider value={{ highlightLiceId }}>
      <MatchCard t={say} slot={slot(over)} redColor="red" blueColor="blue" onClick={() => {}} />
    </BracketHighlightContext.Provider>,
  );
}

/** A translator that shows the key it is asked for, so a test can read which word was used. */
const say = (key: string) => `<${key}>`;

const isClickable = (html: string) => html.includes('role="button"');
const isDimmed = (html: string) => html.includes('opacity-60');

describe('MatchCard words', () => {
  it("says its bout's state with the shared bout word, never an English one of its own (X1, X4)", () => {
    const html = markup({ status: 'completed' }, null);
    expect(html).toContain('&lt;common.status.match.completed&gt;');
    expect(html).not.toContain('Completed');
    // The server sends the bout's own state: a paused bout is Paused, not "Pending".
    expect(markup({ status: 'paused' }, null)).toContain('&lt;common.status.match.paused&gt;');
    expect(markup({ status: 'scheduled' }, null)).toContain(
      '&lt;common.status.match.scheduled&gt;',
    );
  });
});

describe('MatchCard referees', () => {
  it("names a referee duty with no role in the reader's word, never in English", () => {
    const html = renderToStaticMarkup(
      <BracketHighlightContext.Provider value={{ showReferees: true }}>
        <MatchCard
          t={say}
          slot={slot({
            referees: [{ role: null, displayName: 'Léa', status: 'assigned', skillColor: 'slate' }],
          })}
          redColor="red"
          blueColor="blue"
        />
      </BracketHighlightContext.Provider>,
    );
    expect(html).toContain('&lt;common.bracket.referee&gt;');
    expect(html).not.toContain('>Referee<');
  });
});

describe('MatchCard on a Lice-scoped bracket', () => {
  it('opens a match on this Lice', () => {
    expect(isClickable(markup({ liceId: MINE }, MINE))).toBe(true);
  });

  it('refuses a match on another Lice, and says so by dimming it', () => {
    const html = markup({ liceId: THEIRS }, MINE);

    expect(isClickable(html)).toBe(false);
    expect(isDimmed(html)).toBe(true);
  });

  it('leaves this Lice own card undimmed', () => {
    expect(isDimmed(markup({ liceId: MINE }, MINE))).toBe(false);
  });

  it('refuses a slot with no match yet, even on this Lice', () => {
    // A TBD card has nothing to open. A control that cannot act must not look
    // like one.
    expect(isClickable(markup({ liceId: MINE, matchId: null }, MINE))).toBe(false);
  });
});

describe('MatchCard with no Lice scope — the admin and public brackets', () => {
  it('keeps an empty slot clickable, which is how admin opens its override modal', () => {
    expect(isClickable(markup({ matchId: null, liceId: null }, null))).toBe(true);
  });

  it('keeps a card on any Lice clickable, and dims nothing', () => {
    const html = markup({ liceId: THEIRS }, null);

    expect(isClickable(html)).toBe(true);
    expect(isDimmed(html)).toBe(false);
  });
});
