import type { LiveState } from '../../live/use-live-board';
import type { HighlightMatch } from './public-event-data';

/**
 * The bouts the Event home features ("Live now" and "Schedule highlights"): each
 * piste's bout in play and its next bout, named with the piste. Pure, so the
 * server's first picture and the browser's later reads are cut the same way.
 */
export function highlightsOf(state: LiveState | null): HighlightMatch[] {
  return (state?.lices ?? []).flatMap((piste) =>
    [piste.runningMatch, piste.nextMatch]
      .filter((bout) => bout !== null)
      // The piste's name is not on the bout: it comes from the piste around it.
      .map((bout) => ({ ...bout, liceName: piste.lice.name })),
  );
}
