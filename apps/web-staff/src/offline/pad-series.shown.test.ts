/**
 * When the screen lets go of what it remembers of the rounds (`showSeries`).
 *
 * Two stories. (1) The tablet closes a round on a score the server does not
 * share: a card the pad could not price, a custom ruleset, a second tablet.
 * The queue is sent and nothing is refused. The server's row says the round is
 * open. The screen must not keep "closed" for ever. (2) The official takes
 * back the hit that closed a round: the round is open again.
 */
import { describe, expect, it } from 'vitest';
import { padSeries, type PadSeries } from './pad-series';
import { ROUND_1, bout, closedRound, hit } from './pad-series.fixtures';
import { forgotten, showSeries, type SeriesMemory } from './pad-series-memory';

/** Two reads of the bout: a read is known by the object it gave. */
const READ_A = { read: 'a' };
const READ_B = { read: 'b' };

const draw = (now: PadSeries, memory: SeriesMemory | null, read: unknown, held = false) =>
  showSeries(now, memory, { held, bestOf: 3, read });

/** Red reached the cap in round 1 on the tablet. */
const closedOnTablet = padSeries(bout({ queued: [hit('red', 5, 1)] }));
/** The server took the hit; its row is the old one: round 1 open at 0-0. */
const oldRow = padSeries(bout());

describe('while the tablet holds rows to send', () => {
  it('shows the tablet’s view, and stands over nothing: no read is asked for', () => {
    const tapped = draw(closedOnTablet, null, READ_A);

    expect(tapped.view).toBe(closedOnTablet);
    expect(tapped.over).toBeNull();
  });

  it('a read that lands meanwhile changes nothing: the tablet is still ahead', () => {
    const tapped = draw(closedOnTablet, null, READ_A);

    expect(draw(closedOnTablet, tapped, READ_B)).toMatchObject({
      view: closedOnTablet,
      over: null,
    });
  });
});

describe('the tablet is ahead with no round of its own closed', () => {
  it('stands over nothing, also when the view is the same object as before: no read is asked for', () => {
    // Round 1 is the server's own closed round; the tablet opened round 2.
    const server = { ...ROUND_1, awaitingRoundAdvance: true, roundsJson: [closedRound(1, 5, 0)] };
    const inRound2 = padSeries(bout({ server, queued: [hit('blue', 1, 2)] }));
    expect(inRound2).toMatchObject({ round: 2, by: 'tablet' });
    const first = draw(inRound2, null, READ_A);
    expect(first.view).toBe(inRound2);

    expect(draw(inRound2, first, READ_B)).toEqual({ view: inRound2, over: null });
  });
});

describe('the queue is empty and the bout is not read again', () => {
  const tapped = draw(closedOnTablet, null, READ_A);

  it('keeps the round closed, and says it stands over the server’s view: its read is asked for', () => {
    const taken = draw(oldRow, tapped, READ_A);

    expect(taken.view).toBe(closedOnTablet);
    expect(taken.over).toEqual({ read: READ_A });
  });

  it('keeps it over every draw until a read lands, with the read it began on', () => {
    const taken = draw(oldRow, tapped, READ_A);
    const again = draw(oldRow, taken, READ_A);

    expect(again.view).toBe(closedOnTablet);
    expect(again.over).toEqual({ read: READ_A });
  });
});

describe('the server’s row applies from the first read that lands after that', () => {
  const taken = draw(oldRow, draw(closedOnTablet, null, READ_A), READ_A);

  it('when it agrees: the round is closed by the server now', () => {
    const server = { ...ROUND_1, awaitingRoundAdvance: true, redScore: 5 };
    const agreed = padSeries(bout({ server: { ...server, roundsJson: [closedRound(1, 5, 0)] } }));

    expect(draw(agreed, taken, READ_B)).toEqual({ view: agreed, over: null });
  });

  it('when it counts another way and nothing was refused: the screen goes back to the open round', () => {
    // The server counted 4-0: its round 1 is open.
    const disagrees = padSeries(bout({ server: { ...ROUND_1, redScore: 4 } }));

    const shown = draw(disagrees, taken, READ_B);

    expect(shown.view).toBe(disagrees);
    expect(shown.view).toMatchObject({ awaitingStart: false, redScore: 4, by: 'server' });
    expect(shown.over).toBeNull();
  });

  it('and remembers nothing of the tablet’s view after it', () => {
    const answered = draw(oldRow, taken, READ_B);

    expect(draw(oldRow, answered, READ_B).view).toBe(oldRow);
  });

  it('also when that read lands before the screen knew the queue was empty', () => {
    // The read landed while the screen still drew the tablet's queue. The
    // memory begins on it, so it waits for the read that is asked for next.
    const stale = draw(closedOnTablet, draw(closedOnTablet, null, READ_A), READ_B);
    const began = draw(oldRow, stale, READ_B);
    expect(began).toMatchObject({ view: closedOnTablet, over: { read: READ_B } });

    expect(draw(oldRow, began, { read: 'c' }).view).toBe(oldRow);
  });
});

describe('a row of the bout is held in the inbox', () => {
  it('drops the memory at once: the server refused, and its row stands', () => {
    const tapped = draw(closedOnTablet, null, READ_A);

    expect(draw(oldRow, tapped, READ_A, true)).toEqual({ view: oldRow, over: null });
  });
});

describe('the official took an entry back', () => {
  it('shows the view computed, and does not remember the undone hit back', () => {
    // At the tap of Undo the queue is not read again yet: the view computed
    // still holds the hit.
    const atUndo = draw(closedOnTablet, forgotten(closedOnTablet), READ_A);
    expect(atUndo.view).toBe(closedOnTablet);

    // The queue is read: the hit is gone, and the round is open.
    const reread = draw(oldRow, atUndo, READ_A);

    expect(reread).toEqual({ view: oldRow, over: null });
  });

  it('with no undo the same two draws keep the round closed', () => {
    const tapped = draw(closedOnTablet, null, READ_A);

    expect(draw(oldRow, tapped, READ_A).view).toBe(closedOnTablet);
  });

  it('remembers again from the next view: a new capping hit closes the round and keeps it', () => {
    const open = draw(oldRow, forgotten(closedOnTablet), READ_A);
    const again = draw(closedOnTablet, open, READ_A);

    expect(draw(oldRow, again, READ_A).view).toBe(closedOnTablet);
  });
});
