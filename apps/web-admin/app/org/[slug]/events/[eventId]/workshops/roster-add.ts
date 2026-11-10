import { useState } from 'react';
import { apiRequest, failureCode, failureMessage, type ApiFailure } from '@myclash/api-client';
import { fuzzyMatch } from '@myclash/ui';
import { useI18n, type Translator } from '@myclash/next-i18n/client';

/**
 * The organiser adds a person to one session from its roster (operator ruling 535): one of the
 * Event's people, through the server's one booking door for the organiser
 * (`POST workshop-sessions/:id/enrollments/:personId`). A full session puts the person on the
 * waiting list, and the roster says so (536).
 */

/** One of the Event's people, as `GET events/:eventId/persons` lists them. */
export interface EventPerson {
  id: string;
  givenName: string;
  familyName: string;
  clubLabel: string | null;
}

/** At most this many people are offered under the search field. */
export const MAX_CANDIDATES = 8;

export const personName = (p: Pick<EventPerson, 'givenName' | 'familyName'>) =>
  `${p.givenName} ${p.familyName}`;

/**
 * The people offered for `query`: case and accents ignored, given and family name in any order.
 * Nobody for an empty query. `onRoster` holds the roster rows already booked on this session, in
 * any state (a refused person is refused by the server anyway): never a linked profile's id.
 */
export function rosterAddCandidates(
  people: readonly EventPerson[],
  onRoster: ReadonlySet<string>,
  query: string,
): EventPerson[] {
  if (!query.trim()) return [];
  return people
    .filter((p) => !onRoster.has(p.id) && fuzzyMatch(query, personName(p)))
    .slice(0, MAX_CANDIDATES);
}

/** A refused add, in the reader's language: the server's own sentences are English. */
export function rosterAddRefusal(failure: ApiFailure, t: Translator): string | null {
  const words: Record<string, string> = {
    WORKSHOP_ALREADY_BOOKED: 'otherSession',
    INSTRUCTOR_SELF_ENROLLMENT: 'teaches',
    WORKSHOP_BOOKING_REFUSED: 'refused',
    WORKSHOP_SESSION_CANCELLED: 'sessionCancelled',
    PERSON_NOT_IN_EVENT: 'notInEvent',
    // The session was deleted meanwhile: the server's sentence names its id.
    NOT_FOUND: 'sessionGone',
  };
  const key = words[failureCode(failure) ?? ''];
  if (key) return t(`organizer.workshopsPage.add.${key}`);
  return failureMessage(failure, t, t('organizer.workshopsPage.add.failed'));
}

/** What the server answers a booking with. */
interface Booked {
  status: 'confirmed' | 'waitlisted';
  waitlistPosition: number | null;
}

export type RosterAddOutcome =
  | { name: string; status: 'confirmed' }
  | { name: string; status: 'waitlisted'; position: number | null }
  | { error: string }
  | null;

/** The sentence after a booking: a seat, or a place on the waiting list (536). */
export function rosterAddedWords(
  outcome: Exclude<RosterAddOutcome, { error: string } | null>,
  t: Translator,
): string {
  return outcome.status === 'waitlisted'
    ? t('organizer.workshopsPage.add.waitlisted', {
        name: outcome.name,
        position: outcome.position ?? '',
      })
    : t('organizer.workshopsPage.add.seat', { name: outcome.name });
}

export interface RosterAddTarget {
  apiUrl: string;
  eventId: string;
  sessionId: string;
  /** Read the roster again; the page's one owner of roster reads. */
  onAdded: () => Promise<void>;
}

/** The box's state: the Event's people (read once, when the box opens), the search, the add. */
export function useRosterAdd(target: RosterAddTarget) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<EventPerson[] | null>(null);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<RosterAddOutcome>(null);

  async function start() {
    setOpen(true);
    const r = await apiRequest<EventPerson[]>(
      target.apiUrl,
      `/api/v1/events/${target.eventId}/persons`,
    );
    if (r.ok) setPeople(r.data);
    else setPeopleError(failureMessage(r, t, t('organizer.workshopsPage.add.peopleFailed')));
  }

  async function add(person: EventPerson) {
    setBusy(true);
    setOutcome(null);
    try {
      const r = await apiRequest<Booked>(
        target.apiUrl,
        `/api/v1/workshop-sessions/${target.sessionId}/enrollments/${person.id}`,
        { method: 'POST' },
      );
      if (!r.ok) {
        const words = rosterAddRefusal(r, t);
        if (words) setOutcome({ error: words });
        return;
      }
      const name = personName(person);
      setOutcome(
        r.data.status === 'waitlisted'
          ? { name, status: 'waitlisted', position: r.data.waitlistPosition }
          : { name, status: 'confirmed' },
      );
      setQuery('');
      await target.onAdded();
    } finally {
      setBusy(false);
    }
  }

  return { open, start, query, setQuery, people, peopleError, busy, outcome, add };
}
