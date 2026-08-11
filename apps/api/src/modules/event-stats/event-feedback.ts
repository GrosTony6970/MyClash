/**
 * event-feedback.ts — the organiser's view of what people said.
 *
 * Pure. The one rule worth stating out loud is the suppression: a per-role
 * breakdown where a single referee answered names that referee as surely as a
 * signature would. Anonymity that holds on a big event and leaks on a small one
 * is worse than none, because people answered believing it held — so any role
 * segment below the threshold is folded into `other` rather than rendered.
 *
 * Attributed responses are exempt from suppression: those people chose to be
 * named, and hiding them would discard the thing they opted into.
 */

export type RespondentRole = 'fighter' | 'referee' | 'instructor' | 'attendee';

/** Below this many responses, a role segment is not shown on its own. */
export const MIN_SEGMENT_SIZE = 3;

export interface FeedbackRow {
  respondentRole: RespondentRole;
  rating: number;
  comment: string | null;
  isAttributed: boolean;
  /** Only ever set for an attributed row — the gathering layer omits it otherwise. */
  respondentName?: string | null;
}

export interface RoleSegment {
  role: RespondentRole | 'other';
  responses: number;
  averageRating: number;
}

export interface FeedbackComment {
  rating: number;
  comment: string;
  /** null for an anonymous response. Never a placeholder id. */
  attributedTo: string | null;
}

export interface FeedbackSummary {
  totalResponses: number;
  averageRating: number;
  segments: RoleSegment[];
  comments: FeedbackComment[];
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  // One decimal: the extra precision would imply the sample supports it.
  return Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10;
}

export function summariseFeedback(rows: FeedbackRow[]): FeedbackSummary {
  const byRole = new Map<RespondentRole, number[]>();
  for (const row of rows) {
    const bucket = byRole.get(row.respondentRole) ?? [];
    bucket.push(row.rating);
    byRole.set(row.respondentRole, bucket);
  }

  const segments: RoleSegment[] = [];
  const suppressed: number[] = [];
  for (const [role, ratings] of [...byRole.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (ratings.length < MIN_SEGMENT_SIZE) {
      suppressed.push(...ratings);
      continue;
    }
    segments.push({ role, responses: ratings.length, averageRating: average(ratings) });
  }
  if (suppressed.length > 0) {
    segments.push({
      role: 'other',
      responses: suppressed.length,
      averageRating: average(suppressed),
    });
  }

  const comments: FeedbackComment[] = rows
    .filter((row): row is FeedbackRow & { comment: string } => Boolean(row.comment?.trim()))
    .map((row) => ({
      rating: row.rating,
      comment: row.comment.trim(),
      // The flag decides, never the presence of a name: a name that leaked into
      // the row by any other route must still not be shown.
      attributedTo: row.isAttributed ? (row.respondentName ?? null) : null,
    }));

  return {
    totalResponses: rows.length,
    averageRating: average(rows.map((row) => row.rating)),
    segments,
    comments,
  };
}
