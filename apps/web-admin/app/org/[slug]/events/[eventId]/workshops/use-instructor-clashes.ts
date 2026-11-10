'use client';

/**
 * The Workshop board's person warnings (rulings 553-555): reads when the instructors fight or
 * referee, and says, per session, why its card is red.
 *
 * Read when the Schedule tab is shown (and the Workshops have loaded: before that the set of
 * instructors is empty, and a second read would follow at once), and again when the set of
 * instructors changes (a new Workshop or instructor while the tab is open). Fights and duties do
 * not move when a Workshop moves, so a drag re-reads nothing: the teaching clash comes from the
 * Workshops the page holds. A newer read aborts the older one, so a slow answer never lands over a
 * fresher one.
 *
 * The board never looks all clear when nobody checked: until an answer for the current set of
 * instructors arrives it is `checking`, and a failed or malformed answer is `failed`.
 */
import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '@myclash/api-client';
import type { Translator } from '@myclash/next-i18n/client';
import type { WorkshopInstructorBusy } from '@myclash/types';
import { instructorClashes, instructorKey, type ClashWorkshop } from './instructor-clashes';

/** Where the read of the instructors' fights and refereeing stands, as the board says it. */
export type BusyCheck = 'checking' | 'checked' | 'failed';

interface BusyRead {
  /** The set of instructors this answer covers (`instructorKey`); null before any answer. */
  key: string | null;
  busy: WorkshopInstructorBusy[];
  failed: boolean;
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
): { lines: Map<string, string[]>; check: BusyCheck } {
  const [read, setRead] = useState<BusyRead>({ key: null, busy: [], failed: false });
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
          ? { key, busy: result.data.busy, failed: false }
          : { key, busy: [], failed: true },
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

  const check: BusyCheck = read.key !== key ? 'checking' : read.failed ? 'failed' : 'checked';
  return { lines, check };
}
