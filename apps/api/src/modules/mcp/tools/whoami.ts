import type { MyEvent } from '../../me/me-events.service';
import type { McpCaller, McpToolDeps } from '../mcp-server';

type RoleWord = 'fighter' | 'referee' | 'instructor' | 'workshop participant';

export interface WhoAmI {
  email: string | null;
  events: { name: string; slug: string; startDate: string | null; roles: RoleWord[] }[];
}

/** Each role flag of the personal space, as the word a person would use. */
const ROLE_WORDS: readonly (readonly [keyof MyEvent['roles'], RoleWord])[] = [
  ['isCompetitor', 'fighter'],
  ['isReferee', 'referee'],
  ['isInstructor', 'instructor'],
  ['isWorkshopParticipant', 'workshop participant'],
];

/**
 * Who the connector signed in as, and the Events where they hold a role: the list the personal
 * space shows (`me/events`). Names and slugs only, never an id: a model has no use for one, and
 * later tools take a slug.
 */
export async function whoami(caller: McpCaller, deps: McpToolDeps): Promise<WhoAmI> {
  const events = await deps.meEvents.listMyEvents({ userId: caller.userId, staff: null });
  return {
    email: caller.email,
    events: events.map(({ event, roles }) => ({
      name: event.name,
      slug: event.slug,
      startDate: event.startDate,
      roles: ROLE_WORDS.filter(([flag]) => roles[flag]).map(([, word]) => word),
    })),
  };
}
