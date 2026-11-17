import type { BoutNames } from './db';
import { enqueue } from './outbox';

/**
 * A protest's row in the queue: one Fighter's protest, tapped on the pad,
 * written before any network call, as a card is (`queueCard`). Its Fighter's
 * corner rides in `cardedColor`, for the inbox to name them.
 */
export function queueProtest(p: {
  matchId: string;
  sequence: number;
  registrationId: string;
  clockTimeMs: number | null;
  round: number;
  bout: BoutNames;
  cardedColor: 'red' | 'blue';
}): Promise<number> {
  return enqueue({
    kind: 'protest',
    clientUuid: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    ...p,
  });
}
