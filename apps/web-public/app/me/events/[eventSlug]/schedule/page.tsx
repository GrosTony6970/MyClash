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
        { id: block.id, label: block.label, start, end: zonedToUtcIso(day, block.endTime, tz) },
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
  const programme = toContextRows(blocks, startDate, timezone ?? DEFAULT_TZ);
  return (
    <ScheduleView
      schedule={schedule}
      timezone={timezone}
      eventSlug={slug}
      programme={programme}
      updatedAt={updatedAt}
      offline={offline}
    />
  );
}
