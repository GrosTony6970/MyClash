'use client';

import { useParams } from 'next/navigation';
import { zonedToUtcIso } from '@myclash/time';
import type { ProgrammeBlock } from '@myclash/types';
import { Skeleton } from '@myclash/ui';
import { EventHubChrome, HubLoading, HubNotFound } from '@/components/me/EventHubChrome';
import { ScheduleView } from '@/components/me/ScheduleView';
import { useMyEvents, useMySchedule, useProgramme } from '@/components/me/hooks';
import type { ProgrammeContextRow } from '@/components/me/types';

const DEFAULT_TZ = 'Europe/Paris';
// Only non-commitment blocks become schedule context; competition/workshop
// windows are already represented by the user's own bouts + workshops.
const CONTEXT_BLOCK_TYPES = new Set<ProgrammeBlock['blockType']>(['break', 'admin']);

/** A programme block stores wall-clock (dayIndex off the event start + HH:MM);
 *  resolve each to a UTC instant so ScheduleView groups it by the right day. */
function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
  return dt.toISOString().slice(0, 10);
}

/** Scheduled end (epoch ms) of every competition phase block, keyed
 *  `${competitionId}:${competitionPhase}`. Lets the schedule show the block
 *  boundary (e.g. 11:30, rounded up by the generator) as a group's end instead
 *  of the last match's start. Same wall-clock→UTC path as `toContextRows`. */
function phaseWindowsFrom(
  blocks: ProgrammeBlock[],
  startDate: string | null,
  tz: string,
): Map<string, number> {
  const map = new Map<string, number>();
  if (!startDate) return map;
  const base = startDate.slice(0, 10);
  for (const block of blocks) {
    if (block.blockType !== 'competition' || !block.competitionId || !block.competitionPhase) {
      continue;
    }
    const day = addDays(base, block.dayIndex);
    const endIso = zonedToUtcIso(day, block.endTime, tz);
    if (!endIso) continue;
    const endMs = new Date(endIso).getTime();
    if (Number.isNaN(endMs)) continue;
    const key = `${block.competitionId}:${block.competitionPhase}`;
    const prev = map.get(key);
    // Keep the latest end if a phase is split across multiple blocks.
    if (prev == null || endMs > prev) map.set(key, endMs);
  }
  return map;
}

function toContextRows(
  blocks: ProgrammeBlock[],
  startDate: string | null,
  tz: string,
): ProgrammeContextRow[] {
  if (!startDate) return [];
  const base = startDate.slice(0, 10);
  return blocks
    .filter((block) => CONTEXT_BLOCK_TYPES.has(block.blockType))
    .flatMap((block) => {
      const day = addDays(base, block.dayIndex);
      const start = zonedToUtcIso(day, block.startTime, tz);
      if (!start) return [];
      return [
        {
          id: block.id,
          label: block.label,
          start,
          end: zonedToUtcIso(day, block.endTime, tz),
          blockType: block.blockType,
          colorHex: block.colorHex,
        },
      ];
    });
}

/** Per-event hub — Schedule tab (the in-venue "where am I due next"). */
export default function HubSchedulePage() {
  const { eventSlug } = useParams<{ eventSlug: string }>();
  const { events, loading } = useMyEvents();
  const myEvent = events?.find((e) => e.event.slug === eventSlug) ?? null;

  if (loading) return <HubLoading />;
  if (!myEvent) return <HubNotFound />;

  return (
    <EventHubChrome event={myEvent.event} active="schedule">
      <ScheduleTab
        eventId={myEvent.event.id}
        timezone={myEvent.event.timezone}
        startDate={myEvent.event.startDate}
        slug={myEvent.event.slug}
      />
    </EventHubChrome>
  );
}

function ScheduleTab({
  eventId,
  timezone,
  startDate,
  slug,
}: {
  eventId: string;
  timezone: string | null;
  startDate: string | null;
  slug: string;
}) {
  const { schedule, loading, updatedAt, offline } = useMySchedule(eventId);
  const { blocks } = useProgramme(eventId);
  if (loading || !schedule) return <Skeleton className="h-40 w-full rounded-xl" />;
  const tz = timezone ?? DEFAULT_TZ;
  const programme = toContextRows(blocks, startDate, tz);
  const phaseEndByKey = phaseWindowsFrom(blocks, startDate, tz);
  return (
    <ScheduleView
      schedule={schedule}
      timezone={timezone}
      eventSlug={slug}
      programme={programme}
      phaseEndByKey={phaseEndByKey}
      updatedAt={updatedAt}
      offline={offline}
    />
  );
}
