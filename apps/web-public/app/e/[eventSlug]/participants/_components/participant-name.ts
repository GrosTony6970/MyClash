import { nameOrUnknown, type Translator } from '@myclash/ui';
import type { ParticipantLike } from './filter-participants';

/**
 * The name a participant row shows. The server sends a blank name, never an id (X2): a person
 * who fights is an "Unknown fighter", one who only referees an "Unknown referee", anyone else
 * (an instructor) an "Unknown person". No bib: a row may hold several Tournaments.
 */
export function participantName(
  participant: Pick<ParticipantLike, 'displayName' | 'isReferee' | 'tournaments'>,
  t: Translator,
): string {
  const kind =
    participant.tournaments.length > 0 ? 'fighter' : participant.isReferee ? 'referee' : 'person';
  return nameOrUnknown(participant.displayName, kind, t);
}
