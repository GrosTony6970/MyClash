/**
 * feedback.service.ts — workshop ratings + comments (Phase 4).
 *
 * Identity: `workshop_feedback.rater_person_id` is the event-scoped `persons.id`
 * (same convention as `workshop_enrollments.user_id`). One editable rating per
 * participant per workshop (UNIQUE(workshop_id, rater_person_id) → upsert).
 *
 * Eligibility: a participant may rate only after they were enrolled in a session
 * of the workshop that has STARTED (started/completed status, or starts_at in the
 * past). Refused/cancelled enrollments don't qualify.
 *
 * Anonymity: `getWorkshopFeedback` (the instructor view) NEVER projects the
 * rater's identity — only ratings, comments, and aggregates.
 */

import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export interface WorkshopFeedbackEntry {
  rating: number;
  comment: string | null;
}

export interface WorkshopFeedbackSummary {
  average: number | null;
  count: number;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
  comments: Array<{ rating: number; comment: string; createdAt: string }>;
}

@Injectable()
export class FeedbackService {
  constructor(private readonly supabase: SupabaseService) {}

  async submitFeedback(
    workshopId: string,
    personId: string,
    rating: number,
    comment: string | null,
  ): Promise<WorkshopFeedbackEntry> {
    await this.assertEligible(workshopId, personId);

    const { data, error } = await this.supabase.service
      .from('workshop_feedback')
      .upsert(
        {
          workshop_id: workshopId,
          rater_person_id: personId,
          rating,
          comment: comment?.trim() || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'workshop_id,rater_person_id' },
      )
      .select('rating, comment')
      .single();

    if (error) throw new BadRequestException(error.message);
    const row = data as { rating: number; comment: string | null };
    return { rating: row.rating, comment: row.comment };
  }

  async getMyFeedback(workshopId: string, personId: string): Promise<WorkshopFeedbackEntry | null> {
    const { data } = await this.supabase.service
      .from('workshop_feedback')
      .select('rating, comment')
      .eq('workshop_id', workshopId)
      .eq('rater_person_id', personId)
      .maybeSingle();
    if (!data) return null;
    const row = data as { rating: number; comment: string | null };
    return { rating: row.rating, comment: row.comment };
  }

  /** Anonymous aggregate for the instructor — rater identity is never projected. */
  async getWorkshopFeedback(workshopId: string): Promise<WorkshopFeedbackSummary> {
    const { data } = await this.supabase.service
      .from('workshop_feedback')
      .select('rating, comment, created_at')
      .eq('workshop_id', workshopId)
      .order('created_at', { ascending: false });

    const rows = (data ?? []) as Array<{
      rating: number;
      comment: string | null;
      created_at: string;
    }>;

    const distribution: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let sum = 0;
    for (const r of rows) {
      if (r.rating >= 1 && r.rating <= 5) distribution[r.rating as 1 | 2 | 3 | 4 | 5] += 1;
      sum += r.rating;
    }
    const count = rows.length;
    const average = count > 0 ? Math.round((sum / count) * 10) / 10 : null;
    const comments = rows
      .filter((r) => r.comment && r.comment.trim())
      .map((r) => ({ rating: r.rating, comment: r.comment as string, createdAt: r.created_at }));

    return { average, count, distribution, comments };
  }

  private async assertEligible(workshopId: string, personId: string): Promise<void> {
    const now = Date.now();
    const { data: sessions } = await this.supabase.service
      .from('workshop_sessions')
      .select('id, starts_at, status')
      .eq('workshop_id', workshopId);

    const startedSessionIds = (
      (sessions ?? []) as Array<{ id: string; starts_at: string | null; status: string | null }>
    )
      .filter(
        (s) =>
          s.status === 'running' ||
          s.status === 'completed' ||
          (s.starts_at != null && new Date(s.starts_at).getTime() <= now),
      )
      .map((s) => s.id);

    if (startedSessionIds.length === 0) {
      throw new ForbiddenException('Feedback opens after the workshop has started.');
    }

    const { data: enr } = await this.supabase.service
      .from('workshop_enrollments')
      .select('status')
      .eq('user_id', personId)
      .in('workshop_session_id', startedSessionIds);

    const eligible = ((enr ?? []) as Array<{ status: string }>).some(
      (e) => e.status !== 'refused' && e.status !== 'cancelled',
    );
    if (!eligible) {
      throw new ForbiddenException('Only attendees can rate this workshop.');
    }
  }
}
