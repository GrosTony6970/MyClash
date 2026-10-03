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
 *   - Each change of a booking brings its own "starting soon" alert in line (ruling 210):
 *     the alert follows the booking as saved, so it is asked for AFTER the write. It is best
 *     effort (`bookingAlert`): the booking is saved, and the steps after it must still run.
 */

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { NotificationSchedulerService } from '../../workers/notification-scheduler.worker';
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
    private readonly alerts: NotificationSchedulerService,
  ) {}

  // ── Enroll ────────────────────────────────────────────────────────────────────

  /**
   * Book a seat, then ask for the booking's alert: set for a confirmed seat, none for the
   * waitlist. A booking that already exists asks again, which is how a second tap repairs.
   * `again` is the person's own "Register again" on a refusal (ruling 236).
   */
  async enroll(sessionId: string, personId: string, again = false): Promise<EnrollmentResult> {
    if (again) await this.removeRefusal(sessionId, personId);
    const booking = await this.book(sessionId, personId);
    await this.bookingAlert(sessionId, personId);
    return booking;
  }

  private async book(sessionId: string, personId: string): Promise<EnrollmentResult> {
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
      // While the refusal is there, the person cannot book again (he may cancel it: ruling 219).
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

  /**
   * The first half of the person's own "Register again" (ruling 236): remove the refusal, and
   * ONLY a refusal. The booking that follows is anybody's.
   *
   * The race it handles: the refusal is taken back (`accept`) while the person's page still
   * shows it. The delete names the status, so it cannot remove the seat just given back; a
   * plain cancel would, and would hand that seat to the waitlist.
   */
  private async removeRefusal(sessionId: string, personId: string): Promise<void> {
    const { error } = await this.supabase.service
      .from('workshop_enrollments')
      .delete()
      .eq('workshop_session_id', sessionId)
      .eq('user_id', personId)
      .eq('status', 'refused');
    if (error) {
      throw new Error(
        `Refusal of ${personId} in session ${sessionId} not removed: ${error.message}`,
      );
    }
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

  /**
   * Delete one person's booking of a session, whatever its state. Two doors: the person's own
   * cancel, and the organiser's "Remove" (ruling 214), after which the person may book again.
   * The person's own cancel deletes a refusal too, and he may then book again (ruling 219).
   *
   * A delete that fails is a failure, never "removed": answered as done, the seat would be given
   * to the next person while it is still taken.
   *
   * ONE statement deletes the booking and hands back the row it removed. What follows goes by
   * that row, not by an earlier read: of two cancels at the same moment (the organiser's "Remove"
   * and the person's own) only the one that removed the row gives the seat away, and a refusal or
   * a promotion that landed just before is seen as it was saved.
   */
  async cancel(sessionId: string, personId: string): Promise<void> {
    const { data, error } = await this.supabase.service
      .from('workshop_enrollments')
      .delete()
      .eq('workshop_session_id', sessionId)
      .eq('user_id', personId)
      .select('id, status');
    if (error) {
      throw new Error(
        `Booking of ${personId} in session ${sessionId} not deleted: ${error.message}`,
      );
    }
    // Asked for also when no booking was left: a cancel whose alert could not be removed left no
    // booking behind, and a second cancel removes it.
    await this.bookingAlert(sessionId, personId);

    // At most one: a person has one booking per session (UNIQUE in 0001).
    const [removed] = (data ?? []) as Array<{ status: string }>;
    // Freeing a confirmed seat promotes the top of the waitlist.
    if (removed?.status === 'confirmed') {
      await this.promoteNextWaitlisted(sessionId);
    }
    // A place left on the waitlist closes up, or the next booking takes a number already held.
    if (removed?.status === 'waitlisted') {
      await this.recompactWaitlist(sessionId);
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
    await this.bookingAlert(sessionId, personId);

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
    await this.bookingAlert(sessionId, personId);

    if (wasWaitlisted) {
      await this.recompactWaitlist(sessionId);
      await this.notificationEvents.waitlistPromoted(sessionId, personId);
    }
  }

  /**
   * Refuse an enrollee. Sets status 'refused' and keeps the row: while it is there, a plain
   * enroll() answers "removed by the instructor". It is a removal, not a ban (operator ruling
   * 219): the person's own cancel deletes the row, or his "Register again" does (ruling 236),
   * and he may then book again; the instructor refuses him again if needed. A freed confirmed seat promotes the top of the waitlist. No-ops if not
   * enrolled or already refused.
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
    await this.bookingAlert(sessionId, personId);

    if (wasConfirmed) {
      await this.promoteNextWaitlisted(sessionId);
    }
  }

  // ── Private: the booking's own alert ─────────────────────────────────────────

  /**
   * Brings one booking's "starting soon" alert in line with the booking as saved (ruling 210).
   *
   * Best effort, on purpose. The booking write has landed, and what follows it must still run: a
   * freed seat promotes the next person, a promotion tells her. An alert step that throws (the
   * queue is down, or the job is being sent and cannot be removed) would skip those steps, with
   * no call left to repair them. So a failure is logged: the alert then stays as it was until the
   * booking or its session is saved again. One left for a seat that is no longer confirmed does
   * not ring: the seat is read again when it fires (`alert-still-wanted.ts`, ruling 213).
   */
  private async bookingAlert(sessionId: string, personId: string): Promise<void> {
    try {
      await this.alerts.scheduleWorkshopSessionStarting(sessionId, personId);
    } catch (err) {
      this.logger.warn(
        `Workshop alert of booking ${personId} in session ${sessionId} not brought in line: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
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
      await this.bookingAlert(sessionId, promoted.user_id);
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
