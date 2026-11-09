/**
 * Pure geometry for the workshop schedule board.
 *
 * Columns are venue_areas grouped under venue bands: one column per area,
 * and a venue with no areas collapses to a single venue-level column
 * (areaId null). Workshop blocks place every session of a Workshop (a Workshop
 * may run several, operator ruling 515) onto the matching column at its time
 * slot. Everything is pure — no React/IO —
 * so the board can be reasoned about and tested in isolation.
 */

import { zonedDay } from '@myclash/time';
import { GRID_START_HOUR, isoToSlot, SLOT_MINUTES } from './schedule-grid-geometry';

export interface BoardVenue {
  id: string;
  name: string;
  venue_areas?: Array<{ id: string; name: string }> | null;
}

export interface AreaColumn {
  /** Stable key `${venueId}:${areaId ?? '_'}` used for DnD + rendering. */
  key: string;
  venueId: string;
  venueName: string;
  areaId: string | null;
  areaName: string | null;
}

export interface BoardWorkshop {
  id: string;
  title: string;
  durationMinutes: number | null;
  /** Discipline shown as the card's "weapon" (e.g. Longsword). */
  category?: string | null;
  level?: string | null;
  capacity?: number | null;
  /** Identity color token (ColorToken, like tournaments) — tints the card. */
  color?: string | null;
  instructorNames?: string[];
  sessions: Array<{
    id: string;
    startsAt: string | null;
    endsAt: string | null;
    venueId: string | null;
    areaId: string | null;
    confirmedCount?: number;
    /** Drawn struck through; holds no room (rulings 526, 528). Absent: not cancelled. */
    cancelled?: boolean;
  }>;
}

export interface WorkshopBlock {
  workshopId: string;
  sessionId: string;
  title: string;
  columnKey: string;
  startSlot: number;
  endSlot: number;
  span: number; // in slots, ≥ 1
  startsAt: string;
  endsAt: string | null;
  // Card fields.
  category: string | null;
  level: string | null;
  capacity: number | null;
  color: string | null;
  instructorNames: string[];
  confirmedCount: number;
  /** The session was cancelled: drawn struck through, its room free (rulings 526, 528). */
  cancelled: boolean;
}

/**
 * A Workshop session the organiser cancelled (rulings 526-529): shown struck through on every
 * page, never booked, never "live", no clash, and its room is free. A status that is absent (an
 * older copy) is not cancelled. The ONE test of it, in both apps.
 */
export function isCancelledSession(session: { status?: string | null }): boolean {
  return session.status === 'cancelled';
}

export function columnKey(venueId: string, areaId: string | null): string {
  return `${venueId}:${areaId ?? '_'}`;
}

/**
 * Build the ordered column list: one per area, or a single venue-level
 * column when a venue has no areas. Venue order is preserved so
 * `computeVenueGroups`-style banding stays predictable.
 */
export function buildAreaColumns(venues: ReadonlyArray<BoardVenue>): AreaColumn[] {
  const columns: AreaColumn[] = [];
  for (const v of venues) {
    const areas = v.venue_areas ?? [];
    if (areas.length === 0) {
      columns.push({
        key: columnKey(v.id, null),
        venueId: v.id,
        venueName: v.name,
        areaId: null,
        areaName: null,
      });
    } else {
      for (const a of areas) {
        columns.push({
          key: columnKey(v.id, a.id),
          venueId: v.id,
          venueName: v.name,
          areaId: a.id,
          areaName: a.name,
        });
      }
    }
  }
  return columns;
}

/** Contiguous same-venue column runs, for the venue header band. */
export interface ColumnBand {
  venueId: string;
  venueName: string;
  startIndex: number;
  span: number;
}

export function buildColumnBands(columns: ReadonlyArray<AreaColumn>): ColumnBand[] {
  const bands: ColumnBand[] = [];
  columns.forEach((col, i) => {
    const prev = bands[bands.length - 1];
    if (prev && prev.venueId === col.venueId) prev.span += 1;
    else bands.push({ venueId: col.venueId, venueName: col.venueName, startIndex: i, span: 1 });
  });
  return bands;
}

/** Pick the column a session belongs to, or null when it can't be placed. */
function matchColumn(
  columns: ReadonlyArray<AreaColumn>,
  venueId: string | null,
  areaId: string | null,
): AreaColumn | null {
  if (!venueId) return null;
  // Exact area (or venue-level) match first.
  const exact = columns.find(
    (c) => c.venueId === venueId && (c.areaId === areaId || (c.areaId === null && areaId === null)),
  );
  if (exact) return exact;
  // Session pins a venue but its area is gone / unset — fall back to the
  // venue's first column so it still appears on the board.
  return columns.find((c) => c.venueId === venueId) ?? null;
}

const DEFAULT_BLOCK_MINUTES = 60;

/**
 * Blocks for every session that falls on `day` (in `tz`) and maps to a column. A cancelled block
 * comes first: drawn first, it lies UNDER a live one in the same room and hour, which took its
 * room (ruling 528); drawn last, it covered that card and caught its clicks.
 */
export function buildWorkshopSessionBlocks(
  workshops: ReadonlyArray<BoardWorkshop>,
  columns: ReadonlyArray<AreaColumn>,
  day: string,
  tz: string,
  startHour = GRID_START_HOUR,
): WorkshopBlock[] {
  const blocks: WorkshopBlock[] = [];
  for (const w of workshops) {
    for (const session of w.sessions) {
      const block = sessionBlock(w, session, columns, day, tz, startHour);
      if (block) blocks.push(block);
    }
  }
  return [...blocks.filter((b) => b.cancelled), ...blocks.filter((b) => !b.cancelled)];
}

type BoardSession = BoardWorkshop['sessions'][number];

function sessionBlock(
  w: BoardWorkshop,
  session: BoardSession,
  columns: ReadonlyArray<AreaColumn>,
  day: string,
  tz: string,
  startHour: number,
): WorkshopBlock | null {
  if (!session.startsAt || zonedDay(session.startsAt, tz) !== day) return null;
  const col = matchColumn(columns, session.venueId, session.areaId);
  if (!col) return null;

  const startSlot = isoToSlot(session.startsAt, day, tz, startHour);
  const durationMin = session.endsAt
    ? Math.max(
        SLOT_MINUTES,
        (new Date(session.endsAt).getTime() - new Date(session.startsAt).getTime()) / 60_000,
      )
    : (w.durationMinutes ?? DEFAULT_BLOCK_MINUTES);
  const span = Math.max(1, Math.round(durationMin / SLOT_MINUTES));

  return {
    workshopId: w.id,
    sessionId: session.id,
    title: w.title,
    columnKey: col.key,
    startSlot,
    endSlot: startSlot + span,
    span,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    category: w.category ?? null,
    level: w.level ?? null,
    capacity: w.capacity ?? null,
    color: w.color ?? null,
    instructorNames: w.instructorNames ?? [],
    confirmedCount: session.confirmedCount ?? 0,
    cancelled: session.cancelled === true,
  };
}

/** A session the board cannot draw, with its Workshop. */
export interface UnplacedSession<T extends BoardWorkshop> {
  workshop: T;
  session: T['sessions'][number];
}

/**
 * Sessions that exist but cannot be drawn on any board day: no start time (a legacy row; both
 * session routes require one), or no column for their venue (none set, or not on this board).
 * Each is placed by dragging it. A Workshop with NO session is not here: it is in the drawer as
 * every Workshop is, and a drag of it adds a session.
 */
export function unplacedSessions<T extends BoardWorkshop>(
  workshops: ReadonlyArray<T>,
  columns: ReadonlyArray<AreaColumn>,
): Array<UnplacedSession<T>> {
  return workshops.flatMap((workshop) =>
    workshop.sessions
      .filter(
        (session) =>
          !session.startsAt || matchColumn(columns, session.venueId, session.areaId) === null,
      )
      .map((session) => ({ workshop, session })),
  );
}
