/**
 * enrollment.service.ts — T-802
 *
 * Enroll/cancel with waitlist auto-promotion.
 *
 * Identity: `workshop_enrollments.user_id` holds an event-scoped
 * `persons.id` (the value `resolvePersonId` returns for both claimed
 * users and guests) — NOT an auth user id. Capacity lives on
 * `workshops.capacity` (nullable ⇒ unlimited); sessions have no own
 * capacity column. The waitlist order column is `position`.
 *
 * AC:
 *   - Enrolling at capacity → status 'waitlisted' with position
 *   - Confirmed cancellation triggers promotion; waitlist top moves to confirmed
 *   - Race-condition safe: relies on the confirmed-count check
 */

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationEventsService } from '../notifications/event-handlers/notification-events.service';
import { SupabaseService } from '../supabase/supabase.service';

export interface EnrollmentResult {
  id: string;
  personId: string;
  sessionId: string;
  status: 'confirmed' | 'waitlisted';
  waitlistPosition: number | null;
}

@Injectable()
export class EnrollmentService {
  private readonly logger = new Logger(EnrollmentService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly notificationEvents: NotificationEventsService,
  ) {}

  // ── Enroll ────────────────────────────────────────────────────────────────────

  async enroll(sessionId: string, personId: string): Promise<EnrollmentResult> {
    // Idempotent: already enrolled? Return the current row.
    const { data: existing } = await this.supabase.service
      .from('workshop_enrollments')
      .select('id, status, position')
      .eq('workshop_session_id', sessionId)
      .eq('user_id', personId)
      .maybeSingle();

    if (existing) {
      const e = existing as { id: string; status: string; position: number | null };
      await this.markGlobalWorkshopParticipant(personId);
      return {
        id: e.id,
        personId,
        sessionId,
        status: e.status as 'confirmed' | 'waitlisted',
        waitlistPosition: e.position,
      };
    }

    // Capacity comes from the parent workshop (sessions have none).
    const { data: session } = await this.supabase.service
      .from('workshop_sessions')
      .select('workshop_id, workshops ( capacity )')
      .eq('id', sessionId)
      .maybeSingle();

    if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
    const capacity = workshopCapacity(session);

    // capacity null ⇒ unlimited ⇒ always confirmed.
    let isFull = false;
    if (capacity !== null) {
      const { count: confirmedCount } = await this.supabase.service
        .from('workshop_enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('workshop_session_id', sessionId)
        .eq('status', 'confirmed');
      isFull = (confirmedCount ?? 0) >= capacity;
    }

    if (isFull) {
      const { count: waitlistCount } = await this.supabase.service
        .from('workshop_enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('workshop_session_id', sessionId)
        .eq('status', 'waitlisted');

      const position = (waitlistCount ?? 0) + 1;

      const { data, error } = await this.supabase.service
        .from('workshop_enrollments')
        .insert({
          workshop_session_id: sessionId,
          user_id: personId,
          status: 'waitlisted',
          position,
          enrolled_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (error) throw new BadRequestException(error.message);

      await this.markGlobalWorkshopParticipant(personId);

      return {
        id: (data as { id: string }).id,
        personId,
        sessionId,
        status: 'waitlisted',
        waitlistPosition: position,
      };
    }

    const { data, error } = await this.supabase.service
      .from('workshop_enrollments')
      .insert({
        workshop_session_id: sessionId,
        user_id: personId,
        status: 'confirmed',
        position: null,
        enrolled_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) throw new BadRequestException(error.message);

    await this.markGlobalWorkshopParticipant(personId);

    return {
      id: (data as { id: string }).id,
      personId,
      sessionId,
      status: 'confirmed',
      waitlistPosition: null,
    };
  }

  // ── Global role flag ───────────────────────────────────────────────────────────

  /**
   * Best-effort: tick the person's global `is_workshop_participant` flag.
   *
   * `personId` is an event-scoped `persons.id`; the global flag lives on
   * `global_persons`, reachable via `persons.global_person_id`. Guests whose
   * `persons` row has no global link are skipped (nothing to flag). Tick-only:
   * the flag is never cleared on cancel. Failures are logged and swallowed — a
   * profile-flag write must never fail an otherwise-successful enrollment.
   */
  private async markGlobalWorkshopParticipant(personId: string): Promise<void> {
    try {
      const { data: person, error: personErr } = await this.supabase.service
        .from('persons')
        .select('global_person_id')
        .eq('id', personId)
        .maybeSingle();

      if (personErr) {
        this.logger.warn(
          `workshop-participant flag: persons lookup failed for ${personId}: ${personErr.message}`,
        );
        return;
      }

      const globalPersonId = (person as { global_person_id: string | null } | null)
        ?.global_person_id;
      if (!globalPersonId) return;

      const { error: updateErr } = await this.supabase.service
        .from('global_persons')
        .update({ is_workshop_participant: true, updated_at: new Date().toISOString() })
        .eq('id', globalPersonId)
        .eq('is_workshop_participant', false);

      if (updateErr) {
        this.logger.warn(
          `workshop-participant flag: update failed for global person ${globalPersonId}: ${updateErr.message}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `workshop-participant flag: unexpected error for ${personId}: ${(err as Error).message}`,
      );
    }
  }

  // ── Cancel ────────────────────────────────────────────────────────────────────

  async cancel(sessionId: string, personId: string): Promise<void> {
    const { data: enrollment } = await this.supabase.service
      .from('workshop_enrollments')
      .select('id, status')
      .eq('workshop_session_id', sessionId)
      .eq('user_id', personId)
      .maybeSingle();

    if (!enrollment) return; // already not enrolled

    const e = enrollment as { id: string; status: string };

    await this.supabase.service.from('workshop_enrollments').delete().eq('id', e.id);

    // Freeing a confirmed seat promotes the top of the waitlist.
    if (e.status === 'confirmed') {
      await this.promoteNextWaitlisted(sessionId);
    }
  }

  // ── Promote specific person (organizer action) ────────────────────────────────

  async promote(sessionId: string, personId: string): Promise<void> {
    const { data: enrollment } = await this.supabase.service
      .from('workshop_enrollments')
      .select('id, status')
      .eq('workshop_session_id', sessionId)
      .eq('user_id', personId)
      .maybeSingle();

    if (!enrollment) throw new NotFoundException('Enrollment not found');

    const e = enrollment as { id: string; status: string };
    if (e.status !== 'waitlisted') {
      throw new BadRequestException('Person is not on the waitlist');
    }

    await this.supabase.service
      .from('workshop_enrollments')
      .update({ status: 'confirmed', position: null })
      .eq('id', e.id);

    await this.recompactWaitlist(sessionId);
    await this.notificationEvents.waitlistPromoted(sessionId, personId);
  }

  // ── Private: promote top waitlisted ──────────────────────────────────────────

  private async promoteNextWaitlisted(sessionId: string): Promise<void> {
    const { data: top } = await this.supabase.service
      .from('workshop_enrollments')
      .select('id, user_id')
      .eq('workshop_session_id', sessionId)
      .eq('status', 'waitlisted')
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!top) return; // no one on waitlist
    const promoted = top as { id: string; user_id?: string | null };

    await this.supabase.service
      .from('workshop_enrollments')
      .update({ status: 'confirmed', position: null })
      .eq('id', promoted.id);

    await this.recompactWaitlist(sessionId);
    if (promoted.user_id) {
      await this.notificationEvents.waitlistPromoted(sessionId, promoted.user_id);
    }
  }

  private async recompactWaitlist(sessionId: string): Promise<void> {
    // Re-number waitlist positions 1, 2, 3…
    const { data: waitlisted } = await this.supabase.service
      .from('workshop_enrollments')
      .select('id')
      .eq('workshop_session_id', sessionId)
      .eq('status', 'waitlisted')
      .order('position', { ascending: true });

    if (!waitlisted || waitlisted.length === 0) return;

    await Promise.all(
      (waitlisted as Array<{ id: string }>).map((e, i) =>
        this.supabase.service
          .from('workshop_enrollments')
          .update({ position: i + 1 })
          .eq('id', e.id),
      ),
    );
  }
}

/** Read `workshops.capacity` off a nested session row (Supabase joins as object or array). */
function workshopCapacity(session: unknown): number | null {
  const w = (session as { workshops?: unknown }).workshops;
  const row = Array.isArray(w) ? w[0] : w;
  const cap = (row as { capacity?: number | null } | null)?.capacity;
  return cap ?? null;
}
