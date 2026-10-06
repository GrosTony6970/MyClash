/**
 * The order of a direct card (rulings 313, 314).
 *
 * A direct card is a scored artefact, so it goes where a hit goes: on the
 * tablet first, then through the queue, online or not. The drawer closes at
 * once and nothing waits for the send (ruling 316); the server's answer, a
 * refusal included, is the bar's and the inbox's to say.
 *
 * Pure, out of the component: web-staff has no React test setup.
 */

import { queueCard } from '../offline/outbox';

export interface DirectCardSteps {
  /** The tablet's store could not keep the card: say so, in the open drawer. */
  notKept: () => void;
  /** Shut the drawer: the card is kept, the referee goes back to the bout. */
  close: () => void;
  /** Ask for a send; nobody waits for it, and with no connection the card waits. */
  send: () => void;
  /** The bout screen moves its sequence on. */
  recorded: () => void;
}

/**
 * One fault is this module's: the store cannot keep the card. Nothing was
 * sent, the drawer stays open and says so (`notKept`). A fault of the send
 * is not: the card IS kept, nobody waits for the send, and "failed" over a
 * kept card would ask the referee to give it twice.
 */
export async function giveDirectCard(
  card: Parameters<typeof queueCard>[0],
  steps: DirectCardSteps,
): Promise<void> {
  try {
    await queueCard(card);
  } catch {
    steps.notKept();
    return;
  }
  steps.close();
  steps.send();
  steps.recorded();
}
