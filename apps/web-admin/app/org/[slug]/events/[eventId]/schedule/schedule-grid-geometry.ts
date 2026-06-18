/**
 * Shared time-axis geometry for the Schedule canvas — used by BOTH the
 * Detailed grid ([grid.tsx]) and the Block grid ([BlockGridView.tsx]) so
 * the two surfaces agree on slot math, column sizing and venue banding.
 *
 * The axis runs from `GRID_START_HOUR` in `SLOT_MINUTES` steps. The end of
 * the axis is dynamic (see `compute-grid-end.ts`); `DEFAULT_GRID_END_HOUR`
 * is the floor used when there's no later content.
 *
 * Pure: no React, no I/O. `slotToTime`/`isoToSlot` interpret the axis in the
 * EVENT's timezone (via @myclash/time), so the grid reads the same wall-clock
 * for any viewer regardless of their browser timezone. Both anchor on the same
 * `dayStartUtcIso` instant, so they are exact inverses.
 */

import { dayStartUtcIso, minutesIntoDayInZone } from '@myclash/time';

export const SLOT_MINUTES = 5;
export const GRID_START_HOUR = 8;
export const DEFAULT_GRID_END_HOUR = 20;
export const SLOT_HEIGHT_PX = 16;
// Header rows are taller than body rows so the venue + lice names read
// clearly. The lice header's sticky `top` offset must equal
// VENUE_HEADER_HEIGHT_PX so it sticks below the venue band on scroll.
export const VENUE_HEADER_HEIGHT_PX = 40;
export const LICE_HEADER_HEIGHT_PX = 40;
export const TIME_LABEL_COL_PX = 64;
export const MIN_LICE_COL_PX = 140;

// Moves/resizes land on a coarser 15-minute grid even though the axis is
// rendered in 5-minute slots — keeps existing data untouched while giving the
// operator clean :00/:15/:30/:45 drops.
export const SNAP_MINUTES = 15;
export const SNAP_SLOTS = SNAP_MINUTES / SLOT_MINUTES;

export function minutesToSlot(minutes: number): number {
  return Math.floor(minutes / SLOT_MINUTES);
}

/** Round a 5-min slot index to the nearest 15-min boundary (never negative). */
export function snapSlot(slot: number): number {
  return Math.max(0, Math.round(slot / SNAP_SLOTS) * SNAP_SLOTS);
}

/**
 * New START slot when dragging a block's TOP edge, with its END fixed: snap
 * the dragged slot to 15 min, then clamp into [0, end − 1] so the block keeps
 * at least one slot of height and never crosses its own end.
 */
export function resizeStartSlot(dragSlot: number, fixedEndSlot: number): number {
  return Math.min(snapSlot(dragSlot), fixedEndSlot - 1);
}

/** Slot index → UTC ISO instant, with the axis anchored at GRID_START_HOUR in `tz`. */
export function slotToTime(slot: number, day: string, tz: string): string {
  const start = dayStartUtcIso(day, tz, GRID_START_HOUR);
  const base = start ? new Date(start) : new Date(`${day}T00:00:00Z`);
  return new Date(base.getTime() + slot * SLOT_MINUTES * 60_000).toISOString();
}

/** UTC ISO instant → slot index on the `tz` axis (clamped ≥ 0). */
export function isoToSlot(iso: string, day: string, tz: string): number {
  const start = dayStartUtcIso(day, tz, GRID_START_HOUR);
  if (start) {
    const diff = (new Date(iso).getTime() - new Date(start).getTime()) / 60_000;
    return Math.max(0, minutesToSlot(diff));
  }
  const min = minutesIntoDayInZone(iso, tz);
  return min === null ? 0 : Math.max(0, minutesToSlot(min - GRID_START_HOUR * 60));
}

/** Slot index → "HH:MM" on the axis (e.g. slot 0 → "08:00"). */
export function slotToHHMM(slot: number): string {
  const totalMin = GRID_START_HOUR * 60 + slot * SLOT_MINUTES;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Alias used for the grid's hourly ruler labels — same mapping as `slotToHHMM`. */
export const formatSlotTime = slotToHHMM;

/** "HH:MM" → slot index on the axis; clamps times before `GRID_START_HOUR` to 0. */
export function hhmmToSlot(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((s) => Number(s));
  const min = (h ?? 0) * 60 + (m ?? 0) - GRID_START_HOUR * 60;
  return Math.max(0, Math.floor(min / SLOT_MINUTES));
}

export interface VenueGroup {
  venueId: string | null;
  venueName: string | null;
  startIndex: number;
  span: number;
}

/** Minimal shape `computeVenueGroups` reads — any `Lice` is assignable. */
export interface VenueCarrier {
  venues?: { id: string; name: string } | null;
}

/**
 * Group consecutive same-venue lice columns into header bands. Lice with no
 * venue render under a "No venue" header at their position (we don't
 * reorder — sortOrder still wins) so the operator's column layout stays
 * predictable.
 */
export function computeVenueGroups(lices: ReadonlyArray<VenueCarrier>): VenueGroup[] {
  const groups: VenueGroup[] = [];
  for (let i = 0; i < lices.length; i++) {
    const lice = lices[i]!;
    const id = lice.venues?.id ?? null;
    const name = lice.venues?.name ?? null;
    const previous = groups[groups.length - 1];
    if (previous && previous.venueId === id) {
      previous.span += 1;
    } else {
      groups.push({ venueId: id, venueName: name, startIndex: i, span: 1 });
    }
  }
  return groups;
}
