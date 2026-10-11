/**
 * What the bout's screen remembers of its rounds while a send is out.
 *
 * `padSeries` gives the rounds from what the tablet holds NOW. A row the server
 * took leaves the queue at once, and the bout's row is read only when the send
 * has ended: computed in between, the view is behind what the screen showed.
 * This keeps what the screen showed, and says when to let it go.
 *
 * It is the screen's memory: a pad reloaded in the middle of a send loses it
 * for that send, and reads the rounds low until the bout is read.
 *
 * Pure: no store, no React. The hook `usePadRounds` keeps the state.
 */
import { seriesResult } from '@myclash/types';
import { roundsWon, type PadSeries } from './pad-series';

/** How far a view has gone: its round, then "that round is closed". */
const stage = (view: PadSeries) => view.round * 2 + (view.awaitingStart || view.decided ? 1 : 0);

/**
 * The view to SHOW, given the one this screen showed before.
 *
 * The race (plan 14.3): a hit the server takes leaves the queue at once, and
 * the bout's row is read only when the send has ended. In between the queue is
 * empty and the server's row is old, so `padSeries` gives a round at its cap as
 * OPEN: the round-break screen would close and open again, with the scoring
 * buttons live in the gap. The same after a "Start round 2" the server took:
 * the screen would fall back to round 1.
 *
 * So a view of the TABLET stays up while the view computed now is the server's
 * and is BEHIND it. And a round the tablet closed keeps the score and the
 * winner it was closed on, as a result keeps the score "End match" was pressed
 * on: computed again in the middle of a send, from the rows not sent yet, it
 * would read low, with another winner or none.
 *
 * This memory goes when the server's row has caught up (its own closed round
 * replaces the tablet's), and when a row of the bout is held (the server
 * refused: its row stands). `showSeries`, below, holds its two other exits.
 */
export function rememberSeries(
  now: PadSeries,
  before: PadSeries | null,
  held: boolean,
  bestOf: number,
): PadSeries {
  if (held || !before || before.by !== 'tablet') return now;
  if (now.by === 'server') return stage(now) < stage(before) ? before : now;

  const seen = before.closed.filter((round) => round.by === 'tablet');
  const confirmed = (round: number) =>
    now.closed.some((row) => row.round === round && row.by === 'server');
  const kept = seen.filter((row) => !confirmed(row.round) && row.round <= now.round);
  if (kept.length === 0) return now;
  const closed = [
    ...now.closed.filter((row) => !kept.some((keep) => keep.round === row.round)),
    ...kept,
  ].sort((a, b) => a.round - b.round);
  const series = seriesResult(closed, bestOf);
  const stoodOn = closed.find((row) => row.round === now.round);
  return {
    ...now,
    ...(stoodOn ? { redScore: stoodOn.redScore, blueScore: stoodOn.blueScore } : {}),
    closed,
    redRoundWins: roundsWon(closed, 'red'),
    blueRoundWins: roundsWon(closed, 'blue'),
    awaitingStart: stoodOn !== undefined && !series.over,
    decided: series.over ? { winnerColor: series.winnerColor } : null,
  };
}

/** What the screen remembers, between two draws. */
export interface SeriesMemory {
  /** The view the screen shows. */
  view: PadSeries;
  /**
   * Set while the view shown is a remembered one, over a view of the server
   * that is behind it: the read of the bout that was on screen when that
   * began. Null otherwise.
   */
  over: { read: unknown } | null;
  /**
   * The official took an entry back: the view computed at that moment, as
   * text. Nothing is remembered until the view computed differs from it.
   */
  forgotten?: string;
}

/**
 * The view to show at this draw, and what to remember for the next.
 *
 * Two exits of the memory are here.
 *
 * (1) The server's row applies from the first read of the bout that lands
 * after the memory began to stand over it (plan D5). The memory stands over
 * the server's view only once the tablet's queue is empty, so every row is on
 * the server by then, and a read that leaves after that moment holds the
 * server's answer: the same round closed, or, when the server counts another
 * way and nothing was refused (a card the pad could not price, a custom
 * ruleset, a second tablet), the round still open. The caller asks for that
 * read (`over` turning non-null is its signal). Without this exit a series the
 * tablet decided alone stayed "decided" on screen while the bout ran on the
 * server.
 *
 * (2) The official took an entry back (`forgotten`): the queue is read again a
 * moment later, and until the view computed changes nothing is remembered, or
 * the undone hit would be remembered back.
 *
 * The race left: a read of the bout that left BEFORE the last row was taken,
 * and lands after the memory began, drops it one read early. The screen then
 * shows the server's old row until the read that was asked for lands.
 */
export function showSeries(
  now: PadSeries,
  memory: SeriesMemory | null,
  at: { held: boolean; bestOf: number; read: unknown },
): SeriesMemory {
  if (memory?.forgotten !== undefined) {
    return memory.forgotten === JSON.stringify(now)
      ? { view: now, over: null, forgotten: memory.forgotten }
      : { view: now, over: null };
  }
  const before = memory?.view ?? null;
  const view = rememberSeries(now, before, at.held, at.bestOf);
  // The tablet is ahead (it holds rows to send), or the server has caught up.
  if (now.by === 'tablet' || view !== before) return { view, over: null };
  // The memory stands over a view of the server that is behind it.
  const over = memory?.over ?? { read: at.read };
  return at.read === over.read ? { view: before, over } : { view: now, over: null };
}

/** The memory after the official took an entry back: `now` is the view computed at that moment. */
export const forgotten = (now: PadSeries): SeriesMemory => ({
  view: now,
  over: null,
  forgotten: JSON.stringify(now),
});
