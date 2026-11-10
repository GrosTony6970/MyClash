'use client';

/**
 * The Workshop board's person warnings (rulings 553-555): reads when the instructors fight or
 * referee, and says, per session, why its card is red.
 *
 * Read when the Schedule tab is shown, and again when the set of instructors changes (a new
 * Workshop or instructor while the tab is open). Fights and duties do not move when a Workshop
 * moves, so a drag re-reads nothing: the teaching clash comes from the Workshops the page holds.
 * A newer read aborts the older one, so a slow answer never lands over a fresher one.
 *
 * A failed or malformed answer says so (`unchecked`): an empty list would read as "nobody is
 * busy", and nobody checked.
 */
import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '@myclash/api-client';
import type { Translator } from '@myclash/next-i18n/client';
import type { WorkshopInstructorBusy } from '@myclash/types';
import { instructorClashes, instructorKey, type ClashWorkshop } from './instructor-clashes';

interface BusyRead {
  busy: WorkshopInstructorBusy[];
  unchecked: boolean;
}

function isBusyAnswer(data: unknown): data is { busy: WorkshopInstructorBusy[] } {
  return (
    typeof data === 'object' && data !== null && Array.isArray((data as { busy?: unknown }).busy)
  );
}

function sentence(
  clash: { name: string; kind: 'teaches' | 'referees' | 'fights'; against: string },
  t: Translator,
): string {
  const values = { name: clash.name, against: clash.against };
  if (clash.kind === 'teaches') return t('organizer.workshopsPage.board.teachesClash', values);
  if (clash.kind === 'referees') return t('organizer.workshopsPage.board.refereesClash', values);
  return t('organizer.workshopsPage.board.fightsClash', values);
}

export function useInstructorClashes(
  apiUrl: string,
  eventId: string,
  enabled: boolean,
  workshops: ReadonlyArray<ClashWorkshop>,
  t: Translator,
): { lines: Map<string, string[]>; unchecked: boolean } {
  const [read, setRead] = useState<BusyRead>({ busy: [], unchecked: false });
  const key = instructorKey(workshops);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void apiRequest<unknown>(apiUrl, `/api/v1/events/${eventId}/workshop-instructor-busy`, {
      signal: controller.signal,
    }).then((result) => {
      if (controller.signal.aborted) return;
      setRead(
        result.ok && isBusyAnswer(result.data)
          ? { busy: result.data.busy, unchecked: false }
          : { busy: [], unchecked: true },
      );
    });
    return () => controller.abort();
  }, [apiUrl, eventId, enabled, key]);

  const lines = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const [sessionId, clashes] of instructorClashes(workshops, read.busy)) {
      out.set(
        sessionId,
        clashes.map((clash) => sentence(clash, t)),
      );
    }
    return out;
  }, [workshops, read.busy, t]);

  return { lines, unchecked: read.unchecked };
}
