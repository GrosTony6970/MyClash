/**
 * The Workshop board's drawer (slice 2.1, operator rulings 515, 524). A Workshop may run several
 * sessions, so the drawer lists EVERY Workshop: a drag of it adds a session. Under it, each of its
 * sessions the board cannot draw (no time, or no column for its venue): a drag of one places THAT
 * session. Pure, so which session a drag names is tested without a browser.
 */
import {
  SLOT_MINUTES,
  unplacedSessions,
  type AreaColumn,
  type BoardWorkshop,
} from '@myclash/schedule-core';

/** The span a drag carries when nothing gives one: an hour. */
const DEFAULT_SPAN = 60 / SLOT_MINUTES;

export type DrawerEntry<W extends BoardWorkshop> =
  | { kind: 'workshop'; workshop: W; sessions: number }
  | { kind: 'session'; workshop: W; session: W['sessions'][number] };

/** Every Workshop, each followed by its sessions the board cannot draw. */
export function drawerEntries<W extends BoardWorkshop>(
  workshops: readonly W[],
  columns: readonly AreaColumn[],
): Array<DrawerEntry<W>> {
  const unplaced = unplacedSessions(workshops, columns);
  return workshops.flatMap((workshop) => [
    { kind: 'workshop' as const, workshop, sessions: workshop.sessions.length },
    ...unplaced
      .filter((u) => u.workshop.id === workshop.id)
      .map((u) => ({ kind: 'session' as const, workshop, session: u.session })),
  ]);
}

/** Where a drag began: only a card dragged off the GRID is removed by a drop on the drawer. */
export type DragOrigin = 'drawer' | 'grid';

export interface DragPayload {
  workshopId: string;
  /** Empty for a new session; the board then adds one. */
  sessionId: string;
  span: number;
  from: DragOrigin;
}

const spanOf = (minutes: number) => Math.max(1, Math.round(minutes / SLOT_MINUTES));

/** What a drag of a drawer entry carries. */
export function drawerDragPayload<W extends BoardWorkshop>(entry: DrawerEntry<W>): DragPayload {
  const byDuration = entry.workshop.durationMinutes
    ? spanOf(entry.workshop.durationMinutes)
    : DEFAULT_SPAN;
  if (entry.kind === 'workshop') {
    return { workshopId: entry.workshop.id, sessionId: '', span: byDuration, from: 'drawer' };
  }
  const { startsAt, endsAt } = entry.session;
  const span =
    startsAt && endsAt ? spanOf((Date.parse(endsAt) - Date.parse(startsAt)) / 60_000) : byDuration;
  return { workshopId: entry.workshop.id, sessionId: entry.session.id, span, from: 'drawer' };
}

/** Write a drag's payload into the browser's drag data. */
export function writeDrag(data: DataTransfer, payload: DragPayload): void {
  data.setData('workshopId', payload.workshopId);
  data.setData('sessionId', payload.sessionId);
  data.setData('span', String(payload.span));
  data.setData('from', payload.from);
}

/**
 * The session a drop on the drawer removes, or null. A drag released inside the drawer removes
 * nothing: it began there, and a session listed there would otherwise be deleted.
 */
export function sessionRemovedByDrawerDrop(data: Pick<DataTransfer, 'getData'>): string | null {
  if (data.getData('from') !== 'grid') return null;
  return data.getData('sessionId') || null;
}
