import { apiRequest, failureCode, failureMessage, type ApiResult } from '@myclash/api-client';
import { PHOTO_REPORT_LIMIT, type PhotoReportBody } from '@myclash/types';

/**
 * A spectator's Report of a public photo (design Goal 6; rulings 452-453): what it sends, and
 * what the photo's Report button says after it. The photo stays on show whatever the answer.
 */
export type ReportState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'reported' }
  /** Deleted, or photos switched Off meanwhile: the next read drops the tile. */
  | { kind: 'gone'; message: string }
  | { kind: 'failed'; message: string };

type Translate = (key: string, values?: Record<string, string>) => string;

/** The Report, with its comment (none when empty): always a JSON body, never an empty one. */
export function sendReport(
  apiUrl: string,
  eventId: string,
  photoId: string,
  comment: string,
): Promise<ApiResult<{ reported: true }>> {
  return apiRequest<{ reported: true }>(
    apiUrl,
    `/api/v1/events/${eventId}/photos/${photoId}/report`,
    { method: 'POST', body: { comment: comment.trim() || null } satisfies PhotoReportBody },
  );
}

/**
 * The button's state after the answer. The phone's hourly limit is read FIRST: `failureMessage`
 * says every 429 with the throttler's sentence. No signal is passed, so no answer is `aborted`.
 */
export function reportAfter(result: ApiResult<unknown>, t: Translate): ReportState {
  if (result.ok) return { kind: 'reported' };
  if (result.kind === 'http' && result.status === 404) {
    return { kind: 'gone', message: t('publicApp.photos.report.gone') };
  }
  if (failureCode(result) === PHOTO_REPORT_LIMIT) {
    return { kind: 'failed', message: t('publicApp.photos.report.limit') };
  }
  const fallback = t('publicApp.photos.report.failed');
  return { kind: 'failed', message: failureMessage(result, t, fallback) ?? fallback };
}
