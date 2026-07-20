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
 *   - An instructor cannot take a participant seat in a workshop they teach
 */

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
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
    // Session first: it carries both the parent workshop (for the instructor
    // guard below) and the effective capacity (sessions have no own column).
    const { data: session } = await this.supabase.service
      .from('workshop_sessions')
      .select('workshop_id, workshops ( capacity )')
      .eq('id', sessionId)
      .maybeSingle();

    if (!session) throw new NotFoundException(`Session ${sessionId} not found`);

    // An instructor takes no participant seat in a workshop they teach.
    // Checked BEFORE the idempotency read below, so a row that predates this
    // rule can't short-circuit into a success.
    const workshopId = (session as { workshop_id?: string | null }).workshop_id ?? null;
    if (workshopId !== null && (await this.teachesWorkshop(workshopId, personId))) {
      throw new ForbiddenException({
        error: 'InstructorSelfEnrollment',
        message: 'You cannot register for a workshop you teach.',
      });
    }

    // Idempotent: already enrolled? Return the current row.
    const { data: existing } = await this.supabase.service
      .from('workshop_enrollments')
      .select('id, status, position')
      .eq('workshop_session_id', sessionId)
      .eq('user_id', personId)
      .maybeSingle();

    if (existing) {
      const e = existing as { id: string; status: string; position: number | null };
      // Soft-block: an instructor-refused person cannot silently re-register.
      if (e.status === 'refused') {
        throw new ForbiddenException('You were removed from this workshop by the instructor.');
      }
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

  // ── Instructor self-enrollment guard ───────────────────────────────────────────

  /**
   * True when `personId` teaches `workshopId`.
   *
   * Namespace bridge: enrollments are keyed on an event-scoped `persons.id`,
   * instructors on a global `global_persons.id`. Both are UUIDs, so comparing
   * them directly type-checks and then silently never matches — always hop
   * through `persons.global_person_id`. A person with no global link (guest,
   * unclaimed roster row) can't be a linked instructor, so the answer is false;
   * likewise for text-only instructor rows, whose `global_person_id` is null.
   */
  private async teachesWorkshop(workshopId: string, personId: string): Promise<boolean> {
    const globalPersonId = await this.resolveGlobalPersonId(personId);
    if (!globalPersonId) return false;

    const { data } = await this.supabase.service
      .from('workshop_instructors')
      .select('id')
      .eq('workshop_id', workshopId)
      .eq('global_person_id', globalPersonId)
      .maybeSingle(); // UNIQUE(workshop_id, global_person_id) — migration 0103

    return Boolean(data);
  }

  /** `persons.id` → `global_persons.id`; null when unlinked or on lookup error. */
  private async resolveGlobalPersonId(personId: string): Promise<string | null> {
    const { data, error } = await this.supabase.service
      .from('persons')
      .select('global_person_id')
      .eq('id', personId)
      .maybeSingle();

    if (error) {
      this.logger.warn(`persons lookup failed for ${personId}: ${error.message}`);
      return null;
    }
    return (data as { global_person_id: string | null } | null)?.global_person_id ?? null;
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
      const globalPersonId = await this.resolveGlobalPersonId(personId);
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

  // ── Instructor moderation: accept / refuse ─────────────────────────────────────

  /**
   * Accept an enrollee into the workshop — promotes a waitlisted person or
   * reinstates a refused one to 'confirmed'. Idempotent for already-confirmed.
   * Notifies + recompacts only when promoting from the waitlist.
   */
  async accept(sessionId: string, personId: string): Promise<void> {
    const { data: enrollment } = await this.supabase.service
      .from('workshop_enrollments')
      .select('id, status')
      .eq('workshop_session_id', sessionId)
      .eq('user_id', personId)
      .maybeSingle();

    if (!enrollment) throw new NotFoundException('Enrollment not found');
    const e = enrollment as { id: string; status: string };
    if (e.status === 'confirmed') return;
    const wasWaitlisted = e.status === 'waitlisted';

    await this.supabase.service
      .from('workshop_enrollments')
      .update({ status: 'confirmed', position: null })
      .eq('id', e.id);

    if (wasWaitlisted) {
      await this.recompactWaitlist(sessionId);
      await this.notificationEvents.waitlistPromoted(sessionId, personId);
    }
  }

  /**
   * Refuse an enrollee — soft + sticky. Sets status 'refused' (keeps the row so
   * enroll() blocks silent re-registration). A freed confirmed seat promotes the
   * top of the waitlist. No-ops if not enrolled or already refused.
   */
  async refuse(sessionId: string, personId: string): Promise<void> {
    const { data: enrollment } = await this.supabase.service
      .from('workshop_enrollments')
      .select('id, status')
      .eq('workshop_session_id', sessionId)
      .eq('user_id', personId)
      .maybeSingle();

    if (!enrollment) return;
    const e = enrollment as { id: string; status: string };
    if (e.status === 'refused') return;
    const wasConfirmed = e.status === 'confirmed';

    await this.supabase.service
      .from('workshop_enrollments')
      .update({ status: 'refused', position: null })
      .eq('id', e.id);

    if (wasConfirmed) {
      await this.promoteNextWaitlisted(sessionId);
    }
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
