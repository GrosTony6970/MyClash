/**
 * Where the Event home draws its "Live now" block (quick win F6).
 *
 * While the Event runs, people open the home to see what is on: the block is
 * under the header. Before the Event it only announces the first bouts, and
 * stays where it was, after the lists. An Event that is over has none.
 *
 * "The Event runs" is the status its organiser set, the one the header's "Live
 * now" pill reads. It is not "a bout is in play at this minute".
 */
export type LiveBlockPlace = 'top' | 'bottom' | 'none';

export function liveBlockPlace(eventStatus: string): LiveBlockPlace {
  if (eventStatus === 'completed') return 'none';
  return eventStatus === 'running' ? 'top' : 'bottom';
}
