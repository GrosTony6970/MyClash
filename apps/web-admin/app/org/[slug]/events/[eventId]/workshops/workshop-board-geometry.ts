/**
 * Pure geometry for the workshop schedule board.
 *
 * Columns are venue_areas grouped under venue bands: one column per area,
 * and a venue with no areas collapses to a single venue-level column
 * (areaId null). Workshop blocks place each workshop's single session onto
 * the matching column at its time slot. Everything is pure — no React/IO —
 * so the board can be reasoned about and tested in isolation.
 */

import { zonedDay } from '@myclash/time';
import { GRID_START_HOUR, isoToSlot, SLOT_MINUTES } from '../schedule/schedule-grid-geometry';

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

/** Blocks for the workshops whose session falls on `day` (in `tz`) and maps to a column. */
export function buildWorkshopSessionBlocks(
  workshops: ReadonlyArray<BoardWorkshop>,
  columns: ReadonlyArray<AreaColumn>,
  day: string,
  tz: string,
  startHour = GRID_START_HOUR,
): WorkshopBlock[] {
  const blocks: WorkshopBlock[] = [];
  for (const w of workshops) {
    const session = w.sessions[0];
    if (!session?.startsAt) continue;
    if (zonedDay(session.startsAt, tz) !== day) continue;
    const col = matchColumn(columns, session.venueId, session.areaId);
    if (!col) continue;

    const startSlot = isoToSlot(session.startsAt, day, tz, startHour);
    const durationMin = session.endsAt
      ? Math.max(
          SLOT_MINUTES,
          (new Date(session.endsAt).getTime() - new Date(session.startsAt).getTime()) / 60_000,
        )
      : (w.durationMinutes ?? DEFAULT_BLOCK_MINUTES);
    const span = Math.max(1, Math.round(durationMin / SLOT_MINUTES));

    blocks.push({
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
    });
  }
  return blocks;
}

/**
 * Workshops that can't be placed on any board day: no session, no start
 * time, or no/unknown venue. These live in the right-hand drawer.
 */
export function unscheduledWorkshops<T extends BoardWorkshop>(
  workshops: ReadonlyArray<T>,
  columns: ReadonlyArray<AreaColumn>,
): T[] {
  return workshops.filter((w) => {
    const session = w.sessions[0];
    if (!session?.startsAt) return true;
    return matchColumn(columns, session.venueId, session.areaId) === null;
  });
}
