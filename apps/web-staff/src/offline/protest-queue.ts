import type { BoutNames } from './db';
import { enqueue } from './outbox';
import type { QueuedSide } from './queued-side';

/**
 * A protest's row in the queue: one side's protest, a Fighter's or a team's,
 * tapped on the pad, written before any network call, as a card is
 * (`queueCard`). Its corner rides in `cardedColor`, for the inbox to name the
 * side. Answers the protest's `clientUuid`: the pad counts it before the
 * screen shows it.
 */
export async function queueProtest(p: {
  matchId: string;
  sequence: number;
  side: QueuedSide;
  clockTimeMs: number | null;
  round: number;
  bout: BoutNames;
  cardedColor: 'red' | 'blue';
}): Promise<string> {
  const clientUuid = crypto.randomUUID();
  await enqueue({
    kind: 'protest',
    clientUuid,
    occurredAt: new Date().toISOString(),
    ...p,
  });
  return clientUuid;
}
