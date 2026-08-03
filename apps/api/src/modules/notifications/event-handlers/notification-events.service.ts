import { Injectable, Logger } from '@nestjs/common';
import { announcesOnPublish, asEventKind } from '@myclash/types';
import { NotificationSchedulerService } from '../../../workers/notification-scheduler.worker';
import { SupabaseService } from '../../supabase/supabase.service';
import { loadSwissRoundContext } from './swiss-round-context';

interface ContactRow {
  id: string;
  claimed_by_user_id: string | null;
  email: string | null;
}

/**
 * Cap on a single publish announcement, so one pathological organisation
 * cannot wedge the publish request that triggers it.
 */
export const MAX_PUBLISH_FANOUT = 5000;

@Injectable()
export class NotificationEventsService {
  private readonly logger = new Logger(NotificationEventsService.name);

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
      .select('user_id')
      .eq('workshop_session_id', sessionId)
      .eq('status', 'confirmed');

    const personIds = ((enrollments ?? []) as Array<{ user_id: string | null }>)
      .map((enrollment) => enrollment.user_id)
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

  /**
   * Tell a Swiss field that the next round is paired.
   *
   * Fired from the COMMIT path, which under decision 3 runs automatically when
   * the previous round's last bout completes — so this is the moment a fighter
   * learns their next opponent and piste, and there is no organiser action to
   * hang it off instead.
   *
   * Suppressed while the tournament is still `draft`: generating a phase to try
   * the format out must not message the whole field.
   *
   * The bye holder IS notified. Sitting a round out is information they need as
   * much as a pairing, and they are the one person who would otherwise hear
   * nothing at all.
   */
  async swissRoundPublished(roundId: string): Promise<void> {
    const round = await loadSwissRoundContext(this.supabase, roundId);
    if (!round) return;

    const personByRegistration = await this.swissRecipients(round.phaseId, round.roundNumber);
    if (personByRegistration.size === 0) return;

    const contacts = await this.getContacts([...personByRegistration.values()]);
    const byPerson = new Map(contacts.map((contact) => [contact.id, contact]));

    const jobs = [...personByRegistration.entries()].flatMap(([registrationId, personId]) => {
      const contact = byPerson.get(personId);
      if (!contact?.claimed_by_user_id) return [];
      return [
        {
          kind: 'swiss_round_published' as const,
          entityId: roundId,
          userId: contact.claimed_by_user_id,
          title: `${round.tournamentName} — round ${round.roundNumber}`,
          body: round.opponentLine(registrationId),
          url: round.url,
          email: contact.email,
          emailSubject: `${round.tournamentName}: round ${round.roundNumber} pairings`,
          preference: 'swiss_round_published' as const,
        },
      ];
    });
    if (jobs.length === 0) return;

    await this.scheduler.sendImmediateBulk(jobs);
    this.logger.log(`swiss_round_published round=${roundId} recipients=${jobs.length}`);
  }

  /**
   * Who is still in the round: registrationId → persons.id.
   *
   * A withdrawal takes no part from its round on, so telling them who they
   * "face" would be wrong as well as unwanted.
   */
  private async swissRecipients(
    phaseId: string,
    roundNumber: number,
  ): Promise<Map<string, string>> {
    const { data } = await this.supabase.service
      .from('swiss_entrants')
      .select('registration_id, withdrawn_at_round, registrations ( person_id )')
      .eq('phase_id', phaseId);

    const byRegistration = new Map<string, string>();
    for (const entrant of (data ?? []) as Array<{
      registration_id: string;
      withdrawn_at_round: number | null;
      registrations?: { person_id?: string | null } | null;
    }>) {
      if (entrant.withdrawn_at_round !== null && entrant.withdrawn_at_round <= roundNumber) {
        continue;
      }
      const personId = entrant.registrations?.person_id;
      if (personId) byRegistration.set(entrant.registration_id, personId);
    }
    return byRegistration;
  }

  /**
   * Tell an organiser's followers that they published a new event.
   *
   * Called ONLY from the compare-and-set in EventsService.publishEvent /
   * updateEvent, which stamps events.first_published_at and so guarantees this
   * runs at most once per event. That guard lives in the DB rather than here
   * because BullMQ's jobId dedupe expires with removeOnComplete (24h), and an
   * unpublish/republish a week later would otherwise re-spam every follower.
   *
   * The follower queries are inlined rather than delegated to
   * OrganizationFollowsService so NotificationsModule does not have to depend
   * on FollowsModule for two selects.
   */
  async organizerPublishedEvent(eventId: string): Promise<void> {
    const { data: event } = await this.supabase.service
      .from('events')
      .select('id, name, slug, city, start_date, event_kind, organization_id')
      .eq('id', eventId)
      .maybeSingle();
    const row = event as {
      id: string;
      name: string | null;
      slug: string | null;
      city: string | null;
      start_date: string | null;
      event_kind: string | null;
      organization_id: string | null;
    } | null;
    if (!row || !row.organization_id) return;
    // Only standard events announce. Test events are invisible on every public
    // surface so they must not notify either; club events ARE public, but a
    // recurring club night announcing itself to every follower of the
    // organisation reads as spam.
    if (!announcesOnPublish(asEventKind(row.event_kind))) return;

    const { data: org } = await this.supabase.service
      .from('organizations')
      .select('name')
      .eq('id', row.organization_id)
      .maybeSingle();
    const orgName = (org as { name?: string | null } | null)?.name ?? 'An organiser';

    const { data: follows } = await this.supabase.service
      .from('organization_follows')
      .select('follower_user_id')
      .eq('followed_organization_id', row.organization_id)
      .eq('notify_new_event', true)
      .limit(MAX_PUBLISH_FANOUT + 1);
    let followerIds = ((follows ?? []) as Array<{ follower_user_id: string }>).map(
      (f) => f.follower_user_id,
    );
    if (followerIds.length === 0) return;
    if (followerIds.length > MAX_PUBLISH_FANOUT) {
      this.logger.warn(
        `Organisation ${row.organization_id} has more than ${MAX_PUBLISH_FANOUT} followers; truncating the publish announcement.`,
      );
      followerIds = followerIds.slice(0, MAX_PUBLISH_FANOUT);
    }

    // Batched email resolution. A follower is an auth user and may have no
    // persons row at all, in which case they simply get push-only — the worker
    // skips the email fallback when `email` is absent.
    const { data: contacts } = await this.supabase.service
      .from('persons')
      .select('claimed_by_user_id, email')
      .in('claimed_by_user_id', followerIds);
    const emailByUser = new Map<string, string>();
    for (const contact of (contacts ?? []) as Array<{
      claimed_by_user_id: string | null;
      email: string | null;
    }>) {
      if (
        contact.claimed_by_user_id &&
        contact.email &&
        !emailByUser.has(contact.claimed_by_user_id)
      ) {
        emailByUser.set(contact.claimed_by_user_id, contact.email);
      }
    }

    const eventName = row.name ?? 'A new event';
    const detail = [row.start_date, row.city].filter(Boolean).join(' · ');
    const url = row.slug ? `/e/${row.slug}/home` : '/';

    await this.scheduler.sendImmediateBulk(
      followerIds.map((userId) => ({
        kind: 'organizer_published_event' as const,
        entityId: eventId,
        userId,
        title: orgName,
        body: detail ? `${eventName} — ${detail}` : eventName,
        url,
        email: emailByUser.get(userId) ?? null,
        emailSubject: `${orgName} published ${eventName}`,
        preference: 'organizer_updates' as const,
      })),
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
