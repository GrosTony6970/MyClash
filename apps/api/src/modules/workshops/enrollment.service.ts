/**
 * enrollment.service.ts — T-802
 *
 * Enroll/cancel with waitlist auto-promotion.
 *
 * AC:
 *   - Enrolling at capacity → status 'waitlisted' with position
 *   - Confirmed cancellation triggers promotion; waitlist top moves to confirmed
 *   - Race-condition safe: uses DB-level capacity check
 */

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
  constructor(private readonly supabase: SupabaseService) {}

  // ── Enroll ────────────────────────────────────────────────────────────────────

  async enroll(sessionId: string, personId: string): Promise<EnrollmentResult> {
    // Check for existing enrollment (idempotent)
    const { data: existing } = await this.supabase.service
      .from('workshop_enrollments')
      .select('id, status, waitlist_position')
      .eq('session_id', sessionId)
      .eq('person_id', personId)
      .maybeSingle();

    if (existing) {
      const e = existing as { id: string; status: string; waitlist_position: number | null };
      return {
        id: e.id,
        personId,
        sessionId,
        status: e.status as 'confirmed' | 'waitlisted',
        waitlistPosition: e.waitlist_position,
      };
    }

    // Get session capacity + current confirmed count
    const { data: session } = await this.supabase.service
      .from('workshop_sessions')
      .select('capacity')
      .eq('id', sessionId)
      .maybeSingle();

    if (!session) throw new NotFoundException(`Session ${sessionId} not found`);

    const capacity = (session as { capacity: number }).capacity;

    const { count: confirmedCount } = await this.supabase.service
      .from('workshop_enrollments')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .eq('status', 'confirmed');

    const isFull = (confirmedCount ?? 0) >= capacity;

    if (isFull) {
      // Waitlist: get next position
      const { count: waitlistCount } = await this.supabase.service
        .from('workshop_enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', sessionId)
        .eq('status', 'waitlisted');

      const position = (waitlistCount ?? 0) + 1;

      const { data, error } = await this.supabase.service
        .from('workshop_enrollments')
        .insert({
          session_id: sessionId,
          person_id: personId,
          status: 'waitlisted',
          waitlist_position: position,
          enrolled_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (error) throw new BadRequestException(error.message);

      return {
        id: (data as { id: string }).id,
        personId,
        sessionId,
        status: 'waitlisted',
        waitlistPosition: position,
      };
    }

    // Confirmed enrollment
    const { data, error } = await this.supabase.service
      .from('workshop_enrollments')
      .insert({
        session_id: sessionId,
        person_id: personId,
        status: 'confirmed',
        waitlist_position: null,
        enrolled_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) throw new BadRequestException(error.message);

    return {
      id: (data as { id: string }).id,
      personId,
      sessionId,
      status: 'confirmed',
      waitlistPosition: null,
    };
  }

  // ── Cancel ────────────────────────────────────────────────────────────────────

  async cancel(sessionId: string, personId: string): Promise<void> {
    const { data: enrollment } = await this.supabase.service
      .from('workshop_enrollments')
      .select('id, status')
      .eq('session_id', sessionId)
      .eq('person_id', personId)
      .maybeSingle();

    if (!enrollment) return; // already not enrolled

    const e = enrollment as { id: string; status: string };

    // Delete the enrollment
    await this.supabase.service.from('workshop_enrollments').delete().eq('id', e.id);

    // If was confirmed → promote top waitlisted person
    if (e.status === 'confirmed') {
      await this.promoteNextWaitlisted(sessionId);
    }
  }

  // ── Promote specific person (organizer action) ────────────────────────────────

  async promote(sessionId: string, personId: string): Promise<void> {
    const { data: enrollment } = await this.supabase.service
      .from('workshop_enrollments')
      .select('id, status')
      .eq('session_id', sessionId)
      .eq('person_id', personId)
      .maybeSingle();

    if (!enrollment) throw new NotFoundException('Enrollment not found');

    const e = enrollment as { id: string; status: string };
    if (e.status !== 'waitlisted') {
      throw new BadRequestException('Person is not on the waitlist');
    }

    await this.supabase.service
      .from('workshop_enrollments')
      .update({ status: 'confirmed', waitlist_position: null })
      .eq('id', e.id);

    // Recompact waitlist positions
    await this.recompactWaitlist(sessionId);
  }

  // ── Private: promote top waitlisted ──────────────────────────────────────────

  private async promoteNextWaitlisted(sessionId: string): Promise<void> {
    const { data: top } = await this.supabase.service
      .from('workshop_enrollments')
      .select('id')
      .eq('session_id', sessionId)
      .eq('status', 'waitlisted')
      .order('waitlist_position', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!top) return; // no one on waitlist

    await this.supabase.service
      .from('workshop_enrollments')
      .update({ status: 'confirmed', waitlist_position: null })
      .eq('id', (top as { id: string }).id);

    await this.recompactWaitlist(sessionId);
  }

  private async recompactWaitlist(sessionId: string): Promise<void> {
    // Re-number waitlist positions 1, 2, 3…
    const { data: waitlisted } = await this.supabase.service
      .from('workshop_enrollments')
      .select('id')
      .eq('session_id', sessionId)
      .eq('status', 'waitlisted')
      .order('waitlist_position', { ascending: true });

    if (!waitlisted || waitlisted.length === 0) return;

    await Promise.all(
      (waitlisted as Array<{ id: string }>).map((e, i) =>
        this.supabase.service
          .from('workshop_enrollments')
          .update({ waitlist_position: i + 1 })
          .eq('id', e.id),
      ),
    );
  }
}
