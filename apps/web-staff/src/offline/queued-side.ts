/**
 * The side of a queued card or protest: a Fighter's Registration or a team.
 *
 * The pad derives the side from the bout; it never stores a side key (call 9).
 * A queued row keeps the side as one of two fields, `registrationId` or
 * `teamId`, and the send names exactly that one: the server's door refuses a
 * body with both or with neither (call 8).
 *
 * Pure: no store, no React.
 */
import type { OutboxEntry } from './db';

export interface QueuedSide {
  kind: 'registration' | 'team';
  id: string;
}

/** The one field a queued row names its side by. */
export function sideFields(side: QueuedSide): Pick<OutboxEntry, 'registrationId' | 'teamId'> {
  return side.kind === 'team' ? { teamId: side.id } : { registrationId: side.id };
}

/**
 * The side of a queued row, as the send names it: its team, or its Fighter's
 * Registration (a row queued before teams names a Registration). Never both.
 */
export function sideOnWire(
  entry: Pick<OutboxEntry, 'registrationId' | 'teamId'>,
): { teamId: string } | { registrationId: string | undefined } {
  return entry.teamId ? { teamId: entry.teamId } : { registrationId: entry.registrationId };
}
