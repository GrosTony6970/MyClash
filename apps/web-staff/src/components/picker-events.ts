/** The six fields `GET /api/v1/staff-auth/events` returns. Nothing else exists. */
export interface PickerEvent {
  id: string;
  slug: string;
  name: string;
  startDate: string | null;
  status: string;
  kind: string;
}

/**
 * An Event's start date in the language of the screen (quick win S4).
 *
 * The server stores a day with no hour, `2026-08-08`, and the list printed it
 * as stored. It is read as that day in UTC and written in UTC: read in the
 * tablet's own zone, a tablet west of Greenwich would show the day before.
 *
 * The column is text. A value that is not a day is shown as stored.
 */
export function eventDateLabel(startDate: string, locale: string): string {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate);
  if (!day) return startDate;
  const at = new Date(Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3])));
  return at.toLocaleDateString(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export type PickerTab = 'live' | 'upcoming';

export interface PartitionedEvents {
  live: PickerEvent[];
  upcoming: PickerEvent[];
}

/**
 * Live means the event is RUNNING right now; everything else is upcoming.
 *
 * Deliberately keyed on `status` rather than on comparing `startDate` to the
 * clock. A tablet with a wrong clock is a known failure here (it is why
 * migration 0172 records clock skew at all), and an event whose date was typed
 * wrong is one of the cases the Upcoming tab exists to keep reachable. Both
 * would misfile an event under a date comparison; neither can under a status
 * the organiser set on the server.
 */
export function partitionPickerEvents(events: readonly PickerEvent[]): PartitionedEvents {
  return {
    live: events.filter((event) => event.status === 'running'),
    upcoming: events.filter((event) => event.status !== 'running'),
  };
}

/**
 * Open on the tab that has rows.
 *
 * A volunteer signing in before the doors open should not land on an empty
 * Live tab and have to work out that the other one exists.
 */
export function defaultPickerTab(partitioned: PartitionedEvents): PickerTab {
  return partitioned.live.length > 0 ? 'live' : 'upcoming';
}

/**
 * Which event is pre-selected: an explicit tap wins, otherwise the remembered
 * one IF it is still in the list.
 *
 * The "still in the list" condition is the point. A tablet carried from
 * yesterday's event to a different venue today remembers an event that no
 * longer appears — pre-selecting a row that is not on screen would leave the
 * form armed with an invisible answer. Falling back to nothing forces a
 * deliberate choice, which is the correct outcome for exactly that tablet.
 */
export function resolveSelectedEvent(
  events: readonly PickerEvent[],
  tapped: PickerEvent | null,
  rememberedId: string | null,
): PickerEvent | null {
  if (tapped) return tapped;
  if (!rememberedId) return null;
  return events.find((event) => event.id === rememberedId) ?? null;
}
