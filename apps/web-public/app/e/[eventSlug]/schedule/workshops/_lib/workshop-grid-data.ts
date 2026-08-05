/**
 * Server loader for the public workshop schedule grid — the spectator view of
 * the organizer's workshop board.
 *
 * Columns, bands and blocks all come from @myclash/schedule-core's
 * `workshop-board-geometry`, the SAME pure module the admin board uses, so the
 * two surfaces can't drift on placement. What differs is deliberate:
 *
 *  - Venues come from the event-linked public list, not the org catalogue, so
 *    spectators don't see empty rooms the organizer merely could drag into.
 *  - The vertical window is DERIVED from the data (see `deriveStartHour` /
 *    `dayEndSlot`) rather than read from the operator's localStorage, because
 *    the public grid has no window controls.
 *
 * Server-only (plain `fetch`, `cache: 'no-store'`).
 */

import { zonedDay } from '@myclash/time';
import {
  buildAreaColumns,
  buildColumnBands,
  buildWorkshopSessionBlocks,
  eachDay,
  hhmmToSlot,
  unscheduledWorkshops,
  type AreaColumn,
  type BoardWorkshop,
  type ColumnBand,
  type WorkshopBlock,
} from '@myclash/schedule-core';
import { dayEndSlot, deriveStartHour } from './workshop-grid-window';
import { fetchEventInfo } from '../../../_components/EventHeader';
import {
  fetchVenues,
  fetchWorkshopBreaks,
  fetchWorkshops,
  type PublicWorkshop,
  type PublicWorkshopBreak,
} from '../../../home/_lib/public-event-data';

export interface WorkshopGridDay {
  index: number;
  dayKey: string;
  /** Vertical extent of this day, in slots on the `startHour`-anchored axis. */
  endSlot: number;
}

export interface WorkshopGridBlock extends WorkshopBlock {
  dayIndex: number;
  /** Resolved server-side so link policy stays off the client. */
  href: string;
}

/** A workshop the grid can't place — rendered as a list beside it. */
export interface UnlistedWorkshop {
  id: string;
  title: string;
  color: string | null;
  category: string | null;
  level: string | null;
  instructorNames: string[];
  /** Set for `unplaced` (it has a time, just nowhere to put it); null for `undated`. */
  startsAt: string | null;
  href: string;
}

export interface WorkshopScheduleData {
  tz: string;
  /** First hour on the axis — 08:00 unless the day genuinely starts earlier. */
  startHour: number;
  days: WorkshopGridDay[];
  columns: AreaColumn[];
  bands: ColumnBand[];
  blocks: WorkshopGridBlock[];
  breaks: PublicWorkshopBreak[];
  /** No session or no start time — invisible everywhere else on the site. */
  undated: UnlistedWorkshop[];
  /** Timed, but its venue isn't one of the grid's columns. */
  unplaced: UnlistedWorkshop[];
  /** Day tab to open on. Resolved server-side so SSR and hydration agree. */
  initialDayIndex: number;
}

function toBoardWorkshop(w: PublicWorkshop): BoardWorkshop {
  return {
    id: w.id,
    title: w.title,
    durationMinutes: w.durationMinutes,
    category: w.category,
    level: w.level,
    capacity: w.capacity,
    color: w.color,
    instructorNames: w.instructors.map((i) => i.displayName),
    sessions: w.sessions,
  };
}

export async function loadWorkshopSchedule(
  eventSlug: string,
  apiUrl: string,
): Promise<WorkshopScheduleData | null> {
  const [event, workshops, venues, breaks] = await Promise.all([
    fetchEventInfo(eventSlug, apiUrl),
    fetchWorkshops(eventSlug, apiUrl),
    fetchVenues(eventSlug, apiUrl),
    fetchWorkshopBreaks(eventSlug, apiUrl),
  ]);
  if (!event) return null;

  const tz = event.timezone || 'Europe/Paris';
  const href = (slug: string) => `/e/${eventSlug}/w/${encodeURIComponent(slug)}`;

  // Areas carry a sort_order; PostgREST embed order alone is not stable, and an
  // unstable order would reshuffle the grid's columns between requests.
  const workshopVenues = venues
    .filter((v) => v.hosts_workshop)
    .map((v) => ({
      id: v.id,
      name: v.name,
      venue_areas: [...(v.venue_areas ?? [])].sort(
        (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
      ),
    }));
  const columns = buildAreaColumns(workshopVenues);
  const bands = buildColumnBands(columns);

  const boardWorkshops = workshops.map(toBoardWorkshop);
  const slugById = new Map(workshops.map((w) => [w.id, w.slug]));

  // Identical to the admin board's day derivation — that's what makes a break's
  // `dayIndex` point at the same day on both surfaces.
  const dayKeys = eachDay(
    (event.startDate || '').slice(0, 10),
    event.endDate ? event.endDate.slice(0, 10) : null,
  );
  // `eachDay` walks the event's DATE columns in UTC while sessions bucket by
  // their EVENT-zone day, so a far-east timezone can put a session on a day the
  // tabs don't list — and it would then render on no tab at all. Append the
  // strays at the END, leaving indices 0..n-1 (and therefore break dayIndex)
  // untouched.
  for (const w of workshops) {
    const startsAt = w.sessions[0]?.startsAt;
    if (!startsAt) continue;
    const key = zonedDay(startsAt, tz);
    if (key && !dayKeys.includes(key)) dayKeys.push(key);
  }

  const startHour = deriveStartHour(
    workshops.flatMap((w) => (w.sessions[0]?.startsAt ? [w.sessions[0].startsAt] : [])),
    breaks.map((b) => b.startTime),
    tz,
  );

  const blocks: WorkshopGridBlock[] = [];
  dayKeys.forEach((dayKey, dayIndex) => {
    for (const block of buildWorkshopSessionBlocks(
      boardWorkshops,
      columns,
      dayKey,
      tz,
      startHour,
    )) {
      const slug = slugById.get(block.workshopId);
      if (!slug) continue;
      blocks.push({ ...block, dayIndex, href: href(slug) });
    }
  });

  const days: WorkshopGridDay[] = dayKeys.map((dayKey, index) => ({
    index,
    dayKey,
    endSlot: dayEndSlot(startHour, [
      ...blocks.filter((b) => b.dayIndex === index).map((b) => b.endSlot),
      ...breaks.filter((b) => b.dayIndex === index).map((b) => hhmmToSlot(b.endTime, startHour)),
    ]),
  }));

  const unlisted = unscheduledWorkshops(boardWorkshops, columns);
  const undated: UnlistedWorkshop[] = [];
  const unplaced: UnlistedWorkshop[] = [];
  for (const w of unlisted) {
    const slug = slugById.get(w.id);
    if (!slug) continue;
    const startsAt = w.sessions[0]?.startsAt ?? null;
    const row: UnlistedWorkshop = {
      id: w.id,
      title: w.title,
      color: w.color ?? null,
      category: w.category ?? null,
      level: w.level ?? null,
      instructorNames: w.instructorNames ?? [],
      startsAt,
      href: href(slug),
    };
    // No time at all vs. timed-but-homeless: two different things to tell a
    // spectator, so they get two different headings.
    (startsAt === null ? undated : unplaced).push(row);
  }

  const todayKey = zonedDay(new Date().toISOString(), tz);
  const todayIndex = dayKeys.indexOf(todayKey ?? '');

  return {
    tz,
    startHour,
    days,
    columns,
    bands,
    blocks,
    breaks,
    undated,
    unplaced,
    initialDayIndex: todayIndex >= 0 ? todayIndex : 0,
  };
}
