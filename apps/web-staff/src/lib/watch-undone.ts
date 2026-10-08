import type { ApiFailure } from '@myclash/api-client';
import { settleUndone, type Settled } from './settle-undone';

/** How often the pad looks again while a bout screen is open. */
const EVERY_MS = 15_000;

/** The server's list of the bout may have changed, or still shows a hit the referee undid. */
const changesTheList = (settled: Settled) => settled !== 'absent' && settled !== 'kept';

/**
 * Settle the undos the tablet wrote down, while a bout screen is open (ruling
 * 350): now, when the browser says the network is back, at each end of a send,
 * and on a timer. The timer is for a wifi that comes back with no `online`
 * event and nothing to send. One run at a time: a trigger that meets a run in
 * flight is dropped, so a dead wifi piles up nothing. `onSettled` when a run
 * voided an entry, or could not: the screen reads the bout again, and a hit
 * the server kept is on the list again. `onRefused` for each entry of THIS
 * bout the server refused to void (ruling 354): the runs settle every bout,
 * and a refusal about another bout is not this screen's to say. Answers its
 * own stop: a run in flight at the stop tells nobody, its screen is closed.
 */
export function watchUndone(deps: {
  engine: { onSendEnded(ended: () => void): () => void };
  apiUrl: string;
  matchId: string;
  onSettled: () => void;
  onRefused: (refusal: ApiFailure) => void;
  win: Pick<Window, 'addEventListener' | 'removeEventListener' | 'setInterval' | 'clearInterval'>;
}): () => void {
  const { win } = deps;
  let running = false;
  let stopped = false;
  const run = () => {
    if (running) return;
    running = true;
    settleUndone(deps.apiUrl)
      .then((settled) => {
        if (stopped) return;
        if ([...settled.values()].some(changesTheList)) deps.onSettled();
        for (const one of settled.values()) {
          if (typeof one === 'object' && one.matchId === deps.matchId) deps.onRefused(one.refused);
        }
      })
      .catch((err: unknown) => {
        console.error('[undo] the undos written down could not be settled', err);
      })
      .finally(() => {
        running = false;
      });
  };
  run();
  win.addEventListener('online', run);
  const sendEnded = deps.engine.onSendEnded(run);
  const tick = win.setInterval(run, EVERY_MS);
  return () => {
    stopped = true;
    win.removeEventListener('online', run);
    sendEnded();
    win.clearInterval(tick);
  };
}
