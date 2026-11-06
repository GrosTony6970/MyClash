'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { csvFormatParam, type CsvFormat, type PhotoSummary } from '@myclash/types';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { useI18n } from '@myclash/next-i18n/client';
import { getPublicApiUrl } from '@/lib/api-url';

/** Which photos the zip holds: every one, or one Tournament's, or one Workshop's. */
export type DownloadChoice = 'all' | `tournament:${string}` | `workshop:${string}`;

export interface PhotoTagLists {
  tournaments: Array<{ id: string; name: string }>;
  workshops: Array<{ id: string; title: string }>;
}

/** A zip can be asked for: photo storage is set up and the deletion instant has not come. */
export function downloadable(summary: PhotoSummary, now: number): boolean {
  if (summary.storage !== 'on') return false;
  return !summary.deletesAt || Date.parse(summary.deletesAt) > now;
}

/** The zip's link: the csv's spreadsheet, then the one Tournament or Workshop, if any. */
export function downloadPath(eventId: string, choice: DownloadChoice, format: CsvFormat): string {
  const [kind, id] = choice.split(':');
  const tag =
    kind === 'tournament' ? `&tournamentId=${id}` : kind === 'workshop' ? `&workshopId=${id}` : '';
  return `/api/v1/events/${eventId}/photos/download?csv=${csvFormatParam(format)}${tag}`;
}

/** Both lists, or null when either read fails: then only "All photos" is offered. */
async function fetchTagLists(eventId: string): Promise<PhotoTagLists | null> {
  const base = `/api/v1/events/${eventId}`;
  const [tournaments, workshops] = await Promise.all([
    apiRequest<PhotoTagLists['tournaments']>(getPublicApiUrl(), `${base}/tournaments`),
    apiRequest<PhotoTagLists['workshops']>(getPublicApiUrl(), `${base}/workshops`),
  ]);
  if (!tournaments.ok || !workshops.ok) return null;
  return { tournaments: tournaments.data, workshops: workshops.data };
}

/**
 * Follows `href` as a download. Same-origin (production: the admin site and its API share a
 * host), an error answer lands as a failed download, not as the page; across origins (local dev)
 * the browser ignores `download` and an error answer replaces the page.
 */
function follow(href: string): void {
  const link = document.createElement('a');
  link.href = href;
  link.download = '';
  link.click();
}

/** The Event's Tournament and Workshop lists, read once; null when either read fails. */
function useTagLists(eventId: string): PhotoTagLists | null | 'loading' {
  const [tags, setTags] = useState<PhotoTagLists | null | 'loading'>('loading');
  useEffect(() => {
    let live = true;
    void fetchTagLists(eventId).then((lists) => {
      if (live) setTags(lists);
    });
    return () => {
      live = false;
    };
  }, [eventId]);
  return tags;
}

/**
 * "Download all" (design Goal 10). The zip itself is a plain link the browser saves, so a 40-minute
 * download outlives the one-hour login; the click first re-reads the summary through `apiRequest`,
 * which renews a lapsed login, and follows the link only while a zip can still be asked for. A
 * re-read that says otherwise moves `now` to the check's time and reloads the page, so the page
 * shows why (`onStale`): storage off, or the deletion instant passed with the page open.
 *
 * The races: a second pick while the check runs (the button is `busy` until it ends, so one zip
 * starts), and the organiser leaving during the check (no link is followed after unmount). Named,
 * not handled: a browser clock behind the server's can follow the link just after the server
 * started answering 410; that download then fails in the browser.
 */
export function usePhotoDownload(eventId: string, onStale: () => void) {
  const { t } = useI18n();
  const tags = useTagLists(eventId);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const download = useCallback(
    async (choice: DownloadChoice, format: CsvFormat) => {
      setBusy(true);
      const apiUrl = getPublicApiUrl();
      const check = await apiRequest<PhotoSummary>(
        apiUrl,
        `/api/v1/events/${eventId}/photos/summary`,
      );
      if (!mounted.current) return;
      setBusy(false);
      if (!check.ok) {
        const failed = t('organizer.photos.download.failed');
        setFailure(failureMessage(check, t, failed) ?? failed);
        return;
      }
      setFailure(null);
      const checkedAt = Date.now();
      if (!downloadable(check.data, checkedAt)) {
        setNow(checkedAt);
        onStale();
        return;
      }
      follow(`${apiUrl}${downloadPath(eventId, choice, format)}`);
    },
    [eventId, onStale, t],
  );

  return { tags, failure, busy, now, download };
}
