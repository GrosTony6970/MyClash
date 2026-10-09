'use client';

import {
  useOrganizerSelectedEvent,
  type OrgEventSummary,
} from '@/components/organizer-event-context';

/**
 * The Event's status, for an organiser page (ruling 380).
 *
 * Read from the club's own Event list, which the organiser shell holds. Never from
 * `GET /events/:id`: that is the public read, and it answers 404 for a test Event to
 * everybody, so a gate that leaned on it did nothing there.
 *
 * `event` is null until the list is read, and for an Event the list does not hold.
 * A page's gates are open in that moment. The list is read when the shell opens and
 * again after a screen changes a status: an Event that archives itself while the tab
 * is open reads as live until a reload.
 */
export function useEventStatus(eventId: string): {
  event: OrgEventSummary | null;
  isReadOnly: boolean;
  isArchived: boolean;
} {
  const { events } = useOrganizerSelectedEvent();
  const event = events.find((e) => e.id === eventId) ?? null;
  const isArchived = event?.status === 'archived';
  return { event, isReadOnly: isArchived, isArchived };
}
