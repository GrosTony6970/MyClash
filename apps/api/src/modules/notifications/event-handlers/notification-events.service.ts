import { Injectable } from '@nestjs/common';
import { NotificationSchedulerService } from '../../../workers/notification-scheduler.worker';
import { SupabaseService } from '../../supabase/supabase.service';

interface ContactRow {
  id: string;
  claimed_by_user_id: string | null;
  email: string | null;
}

@Injectable()
export class NotificationEventsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly scheduler: NotificationSchedulerService,
  ) {}

  async assignmentChanged(assignmentId: string): Promise<void> {
    const { data: assignment } = await this.supabase.service
      .from('referee_assignments')
      .select('id, event_id, person_id, role, matches ( match_number_label )')
      .eq('id', assignmentId)
      .maybeSingle();
    if (!assignment) return;

    const row = assignment as {
      id: string;
      event_id: string;
      person_id: string | null;
      role: string | null;
      matches?: { match_number_label?: string | null } | null;
    };
    if (!row.person_id) return;

    // Post-0063: row.person_id is global_persons.id. Resolve to an
    // event-scoped persons row (for email + claimed_by_user_id).
    const contact = await this.getContactByGlobalPerson(row.event_id, row.person_id);
    if (!contact?.claimed_by_user_id) return;

    await this.scheduler.sendImmediate({
      kind: 'assignment_changed',
      entityId: row.id,
      userId: contact.claimed_by_user_id,
      title: 'Referee assignment updated',
      body: `${row.role ?? 'Your referee assignment'}${
        row.matches?.match_number_label ? ` for ${row.matches.match_number_label}` : ''
      } has been updated.`,
      url: '/notifications',
      email: contact.email,
      emailSubject: 'Referee assignment updated',
      preference: 'schedule_changes',
    });
  }

  async workshopCancelled(sessionId: string): Promise<void> {
    const title = await this.getWorkshopTitle(sessionId);
    const { data: enrollments } = await this.supabase.service
      .from('workshop_enrollments')
      .select('person_id')
      .eq('session_id', sessionId)
      .eq('status', 'confirmed');

    const personIds = ((enrollments ?? []) as Array<{ person_id: string | null }>)
      .map((enrollment) => enrollment.person_id)
      .filter((id): id is string => Boolean(id));
    const contacts = await this.getContacts(personIds);

    await Promise.all(
      contacts.map((contact) => {
        if (!contact.claimed_by_user_id) return undefined;
        return this.scheduler.sendImmediate({
          kind: 'workshop_cancelled',
          entityId: sessionId,
          userId: contact.claimed_by_user_id,
          title: 'Workshop cancelled',
          body: `${title} was cancelled.`,
          url: '/notifications',
          email: contact.email,
          emailSubject: 'Workshop cancelled',
        });
      }),
    );
  }

  async waitlistPromoted(sessionId: string, personId: string): Promise<void> {
    const [title, contact] = await Promise.all([
      this.getWorkshopTitle(sessionId),
      this.getContact(personId),
    ]);
    if (!contact?.claimed_by_user_id) return;

    await this.scheduler.sendImmediate({
      kind: 'waitlist_promoted',
      entityId: sessionId,
      userId: contact.claimed_by_user_id,
      title: 'Workshop place confirmed',
      body: `You have been promoted from the waitlist for ${title}.`,
      url: '/notifications',
      email: contact.email,
      emailSubject: 'Workshop place confirmed',
    });
  }

  async resultsPublished(tournamentId: string): Promise<void> {
    const { data: tournament } = await this.supabase.service
      .from('tournaments')
      .select('id, name')
      .eq('id', tournamentId)
      .maybeSingle();
    if (!tournament) return;

    const tournamentName = (tournament as { name?: string | null }).name ?? 'Tournament';
    const { data: registrations } = await this.supabase.service
      .from('registrations')
      .select('person_id')
      .eq('tournament_id', tournamentId);
    const personIds = ((registrations ?? []) as Array<{ person_id: string | null }>)
      .map((registration) => registration.person_id)
      .filter((id): id is string => Boolean(id));
    const contacts = await this.getContacts(personIds);

    await Promise.all(
      contacts.map((contact) => {
        if (!contact.claimed_by_user_id) return undefined;
        return this.scheduler.sendImmediate({
          kind: 'results_published',
          entityId: tournamentId,
          userId: contact.claimed_by_user_id,
          title: 'Results published',
          body: `${tournamentName} results are now published.`,
          url: '/notifications',
          email: contact.email,
          emailSubject: 'Results published',
          preference: 'results_published',
        });
      }),
    );
  }

  private async getWorkshopTitle(sessionId: string): Promise<string> {
    const { data: session } = await this.supabase.service
      .from('workshop_sessions')
      .select('id, workshops ( title )')
      .eq('id', sessionId)
      .maybeSingle();
    return (
      (session as { workshops?: { title?: string | null } | null } | null)?.workshops?.title ??
      'Your workshop'
    );
  }

  private async getContact(personId: string): Promise<ContactRow | null> {
    const { data } = await this.supabase.service
      .from('persons')
      .select('id, claimed_by_user_id, email')
      .eq('id', personId)
      .maybeSingle();
    return (data as ContactRow | null) ?? null;
  }

  /**
   * Resolve a global_persons.id (post-0063 referee identity) to the
   * event-scoped persons row carrying the email + claimed_by_user_id.
   * Used by referee notification paths where the source identity is
   * global, but email delivery is per-event.
   */
  private async getContactByGlobalPerson(
    eventId: string,
    globalPersonId: string,
  ): Promise<ContactRow | null> {
    const { data } = await this.supabase.service
      .from('persons')
      .select('id, claimed_by_user_id, email')
      .eq('event_id', eventId)
      .eq('global_person_id', globalPersonId)
      .maybeSingle();
    return (data as ContactRow | null) ?? null;
  }

  private async getContacts(personIds: string[]): Promise<ContactRow[]> {
    if (personIds.length === 0) return [];
    const { data } = await this.supabase.service
      .from('persons')
      .select('id, claimed_by_user_id, email')
      .in('id', personIds);
    return (data ?? []) as ContactRow[];
  }
}
