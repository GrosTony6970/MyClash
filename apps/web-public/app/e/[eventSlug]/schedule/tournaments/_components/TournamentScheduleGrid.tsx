'use client';

/**
 * Read-only public timeline for an event's tournament schedule — the polished
 * spectator view of the admin "Event Command Center" board. Lices are columns,
 * 5-min slots are rows; pool / bracket runs are positioned blocks and
 * registration / gear-check / referee-meeting / lunch are full-width bars.
 *
 * Re-skinned in the public app's LIGHT design tokens and stripped of every
 * admin affordance (no drag/resize/edit/generate/sidebar). Blocks link to their
 * tournament; a subtle now-line marks the current time on today's tab. "Current"
 * comes from the shared `useClientClock`, so an active super-admin time
 * simulation moves both the now-line and the day tab it opens on.
 *
 * Geometry + block model come from the shared @myclash/schedule-core package,
 * so this reads the exact same wall-clock the organizer laid out, in the event
 * timezone, for any viewer.
 */

import Link from 'next/link';
import { useState } from 'react';
import { formatInZone, zonedDay } from '@myclash/time';
import {
  accentClassFor,
  tintBgClassFor,
  tintBorderClassFor,
  tintTextClassFor,
  useClientClock,
} from '@myclash/ui';
import {
  computeVenueGroups,
  formatSlotTime,
  isoToSlot,
  nowSlotForDay,
  venueColor,
  LICE_HEADER_HEIGHT_PX,
  MIN_LICE_COL_PX,
  SLOT_HEIGHT_PX,
  SNAP_SLOTS,
  TIME_LABEL_COL_PX,
  VENUE_HEADER_HEIGHT_PX,
} from '@myclash/schedule-core';
import { useI18n } from '@/i18n/I18nProvider';
import { getPublicApiUrl } from '@/lib/api-url';
import type { TournamentScheduleData } from '../_lib/schedule-grid-data';

interface Props {
  data: TournamentScheduleData;
  eventSlug: string;
  emptyLabel: string;
}

export function TournamentScheduleGrid({ data, eventSlug, emptyLabel }: Props) {
  const { t, locale } = useI18n();
  const { tz, days, lices, blocks, breaks, gridEndByDay, tournaments, initialDayIndex } = data;
  // null until the viewer picks a tab themselves — their choice then wins forever.
  const [pickedDayIndex, setPickedDayIndex] = useState<number | null>(null);
  const { nowMs: clock, simulated } = useClientClock(getPublicApiUrl());

  if (lices.length === 0 || (blocks.length === 0 && breaks.length === 0)) {
    return <p className="text-sm text-muted">{emptyLabel}</p>;
  }

  const nowIso = clock > 0 ? new Date(clock).toISOString() : null;

  // `initialDayIndex` is computed server-side off the real clock, so under a time
  // simulation it opens the wrong tab and the now-line lands on a day nobody is
  // looking at. Derive the simulated day in render (no effect, so no
  // setState-in-effect) and let it win until the viewer picks a tab.
  const simulatedDay =
    simulated && nowIso ? days.find((d) => d.dayKey === zonedDay(nowIso, tz)) : undefined;
  const activeIndex = pickedDayIndex ?? simulatedDay?.index ?? initialDayIndex;

  const activeDay = days[activeIndex] ?? days[0]!;
  const dayKey = activeDay.dayKey;
  const gridEndSlot = gridEndByDay[activeDay.index] ?? 144;
  const dayBlocks = blocks.filter((b) => b.dayIndex === activeDay.index);
  const dayBreaks = breaks.filter((b) => b.dayIndex === activeDay.index);
  const liceIndexById = new Map(lices.map((l, i) => [l.id, i]));
  const venueGroups = computeVenueGroups(lices);
  const hasAnyVenue = lices.some((l) => Boolean(l.venues));

  // Body row for a slot: row 1 = venue band, row 2 = lice header, slot 0 → row 3.
  const rowFor = (slot: number): number => slot + 3;
  const lastRow = gridEndSlot + 3;

  const nowSlot =
    nowIso && zonedDay(nowIso, tz) === dayKey ? nowSlotForDay(nowIso, dayKey, tz) : null;

  const timeOpts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };

  return (
    <div className="flex flex-col gap-4">
      {/* Day tabs */}
      {days.length > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          {days.map((day) => {
            const active = day.index === activeDay.index;
            return (
              <button
                key={day.dayKey}
                type="button"
                onClick={() => setPickedDayIndex(day.index)}
                aria-pressed={active}
                className={[
                  'rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors',
                  active
                    ? 'border-accent bg-accent text-accent-foreground'
                    : 'border-border bg-surface text-muted hover:text-foreground',
                ].join(' ')}
              >
                {new Date(`${day.dayKey}T00:00:00Z`).toLocaleDateString(locale, {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  timeZone: 'UTC',
                })}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Tournament color legend */}
      {tournaments.length > 0 ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {tournaments.map((tour) => {
            const dot = (
              <span className={`h-2.5 w-2.5 rounded-full ${accentClassFor(tour.color)}`} />
            );
            const label = (
              <>
                {dot}
                <span className="text-xs font-semibold text-foreground-secondary">{tour.name}</span>
              </>
            );
            return tour.slug ? (
              <Link
                key={tour.name}
                href={`/e/${eventSlug}/t/${encodeURIComponent(tour.slug)}`}
                className="flex items-center gap-1.5 hover:opacity-80"
              >
                {label}
              </Link>
            ) : (
              <span key={tour.name} className="flex items-center gap-1.5">
                {label}
              </span>
            );
          })}
        </div>
      ) : null}

      {/* Grid */}
      <div className="overflow-x-auto rounded-xl border border-border bg-surface pb-2">
        <div
          className="relative grid w-full"
          style={{
            gridTemplateColumns: `${TIME_LABEL_COL_PX}px repeat(${lices.length}, minmax(${MIN_LICE_COL_PX}px, 1fr))`,
            // Rows 1–2 are the (taller) venue band + lice-header; body rows below
            // are 5-min slots. Explicit template rows keep the two headers from
            // overlapping (the admin grid stacks them with sticky offsets instead).
            gridTemplateRows: `${VENUE_HEADER_HEIGHT_PX}px ${LICE_HEADER_HEIGHT_PX}px`,
            gridAutoRows: `${SLOT_HEIGHT_PX}px`,
          }}
        >
          {/* Row 1: corner + venue band */}
          <div
            className="sticky left-0 z-30 bg-surface"
            style={{ gridColumn: 1, gridRow: 1, height: VENUE_HEADER_HEIGHT_PX }}
          />
          {hasAnyVenue
            ? venueGroups.map((g, i) => {
                const tint = venueColor(g.venueId);
                return (
                  <div
                    key={`venue-${i}`}
                    className="flex items-center justify-center truncate border-b border-border px-2 text-sm font-semibold text-foreground-secondary"
                    style={{
                      gridColumn: `${g.startIndex + 2} / span ${g.span}`,
                      gridRow: 1,
                      height: VENUE_HEADER_HEIGHT_PX,
                      ...(tint ?? {}),
                    }}
                  >
                    {g.venueName ?? ''}
                  </div>
                );
              })
            : null}

          {/* Row 2: time-label corner + per-lice header */}
          <div
            className="sticky left-0 z-30 flex items-end justify-end bg-surface pb-0.5 pr-1 text-[10px] font-semibold uppercase tracking-wide text-muted"
            style={{
              gridColumn: 1,
              gridRow: 2,
              top: VENUE_HEADER_HEIGHT_PX,
              height: LICE_HEADER_HEIGHT_PX,
            }}
          />
          {lices.map((lice, idx) => (
            <div
              key={`head-${lice.id}`}
              className="flex flex-col items-center justify-center border-b border-l border-border bg-surface px-1"
              style={{ gridColumn: idx + 2, gridRow: 2, height: LICE_HEADER_HEIGHT_PX }}
            >
              <span className="truncate text-xs font-bold uppercase tracking-wider text-foreground-secondary">
                {lice.name}
              </span>
            </div>
          ))}

          {/* Faint 15-min gridlines (skip the hour rows) */}
          {Array.from({ length: gridEndSlot }, (_, slot) =>
            slot % SNAP_SLOTS === 0 && slot % 12 !== 0 ? (
              <div
                key={`q-${slot}`}
                aria-hidden="true"
                className="pointer-events-none border-t border-border/20"
                style={{ gridColumn: '2 / -1', gridRow: rowFor(slot) }}
              />
            ) : null,
          )}

          {/* Left ruler: hour labels + faint full-width hour lines */}
          {Array.from({ length: gridEndSlot }, (_, slot) =>
            slot % 12 === 0 ? (
              <div key={`ruler-${slot}`} className="contents">
                <div
                  className="sticky left-0 z-10 flex select-none items-start justify-end border-t border-border/60 bg-surface pr-1 text-[10px] text-muted"
                  style={{ gridColumn: 1, gridRow: rowFor(slot) }}
                >
                  {formatSlotTime(slot)}
                </div>
                <div
                  aria-hidden="true"
                  className="pointer-events-none border-t border-border/40"
                  style={{ gridColumn: '2 / -1', gridRow: rowFor(slot) }}
                />
              </div>
            ) : null,
          )}

          {/* Per-lice column separators (behind blocks) */}
          {lices.map((lice, idx) => (
            <div
              key={`col-${lice.id}`}
              aria-hidden="true"
              className={
                idx % 2 === 1
                  ? 'border-l border-border bg-foreground/[0.015]'
                  : 'border-l border-border'
              }
              style={{ gridColumn: idx + 2, gridRow: `3 / ${lastRow}`, zIndex: 0 }}
            />
          ))}

          {/* Break / ceremony bars — full width */}
          {dayBreaks.map((brk) => {
            const endSlot = brk.startSlot + brk.span;
            return (
              <div
                key={`brk-${brk.id}`}
                className="flex items-center justify-center overflow-hidden border-y border-border bg-surface px-2 text-[11px] font-semibold uppercase tracking-wide text-muted"
                style={{
                  gridColumn: '2 / -1',
                  gridRow: `${rowFor(brk.startSlot)} / ${rowFor(Math.max(brk.startSlot + 1, endSlot))}`,
                  zIndex: 6,
                  ...(brk.colorHex ? { color: brk.colorHex, borderColor: brk.colorHex } : {}),
                }}
              >
                <span className="truncate">{`${brk.label} (${brk.startTime}–${brk.endTime})`}</span>
              </div>
            );
          })}

          {/* Pool / bracket blocks — span their lice column(s) */}
          {dayBlocks.map((block) => {
            const indices = block.liceIds
              .map((id) => liceIndexById.get(id))
              .filter((i): i is number => i != null);
            if (indices.length === 0) return null;
            const colStart = Math.min(...indices) + 2;
            const colEnd = Math.max(...indices) + 3;
            const startSlot = isoToSlot(block.startIso, dayKey, tz);
            const endSlot = isoToSlot(block.endIso, dayKey, tz);
            const blockHeightPx = Math.max(1, endSlot - startSlot) * SLOT_HEIGHT_PX;
            const showSubLine = blockHeightPx >= 28;
            const showTournamentLine = blockHeightPx >= 44;
            const color = block.tournamentColor;
            const fightsLabel =
              block.matchCount === 1
                ? t('publicApp.eventHome.schedule.fightCountSingular', { count: block.matchCount })
                : t('publicApp.eventHome.schedule.fightCountPlural', { count: block.matchCount });
            const timeRange = `${formatInZone(block.startIso, tz, timeOpts, locale)}–${formatInZone(block.endIso, tz, timeOpts, locale)}`;

            const body = (
              <>
                <span
                  aria-hidden="true"
                  className={`absolute inset-y-0 left-0 w-1 ${accentClassFor(color)}`}
                />
                {block.tournamentName && showTournamentLine ? (
                  <span className="truncate text-[11px] font-semibold uppercase tracking-wide opacity-70">
                    {block.tournamentName}
                  </span>
                ) : null}
                <span className="truncate text-sm font-bold leading-tight">{block.label}</span>
                {showSubLine ? (
                  <span className="truncate text-xs font-medium opacity-80">
                    {`${fightsLabel} · ${timeRange}`}
                  </span>
                ) : null}
              </>
            );

            const className = [
              'group relative m-px flex flex-col overflow-hidden rounded-md border py-1 pl-2.5 pr-1.5 transition-opacity',
              tintBgClassFor(color),
              tintBorderClassFor(color),
              tintTextClassFor(color),
            ].join(' ');
            const style = {
              gridColumn: `${colStart} / ${colEnd}`,
              gridRow: `${rowFor(startSlot)} / ${rowFor(Math.max(startSlot + 1, endSlot))}`,
              zIndex: 10,
            } as const;
            const title = `${block.tournamentName ?? ''} · ${block.label} · ${fightsLabel}`;

            return block.tournamentSlug ? (
              <Link
                key={block.key}
                href={`/e/${eventSlug}/t/${encodeURIComponent(block.tournamentSlug)}`}
                title={title}
                className={`${className} hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-accent/40`}
                style={style}
              >
                {body}
              </Link>
            ) : (
              <div key={block.key} title={title} className={className} style={style}>
                {body}
              </div>
            );
          })}

          {/* "Now" marker — full-width line on today's tab */}
          {nowSlot !== null && nowSlot < gridEndSlot ? (
            <div
              className="pointer-events-none relative"
              style={{ gridColumn: '2 / -1', gridRow: rowFor(nowSlot), zIndex: 15 }}
            >
              <span className="absolute inset-x-0 top-0 border-t-2 border-accent" />
              <span className="absolute left-1 top-0 -translate-y-1/2 rounded bg-accent px-1 py-0.5 text-[9px] font-bold uppercase leading-none text-accent-foreground">
                {t('publicApp.eventHome.schedule.now')}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
