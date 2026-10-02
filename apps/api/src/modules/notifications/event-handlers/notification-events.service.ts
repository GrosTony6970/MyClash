import { Injectable, Logger } from '@nestjs/common';
import { announcesOnPublish, asEventKind } from '@myclash/types';
import { isPublicTournamentEmbed } from '../../../common/auth/competition-visibility';
import {
  NotificationSchedulerService,
  type ScheduledNotificationJob,
} from '../../../workers/notification-scheduler.worker';
import { SupabaseService } from '../../supabase/supabase.service';
import { accountEmails } from '../account-emails';
import * as texts from '../notice-texts/notice-texts';
import { lockedDutyIds } from './locked-duties';
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

  /**
   * Send again the lock messages of an Event's locked duties, or of one Tournament's, as a draft
   * goes to published or running (rulings 186, 190, 191): the send gate dropped each while it was a
   * draft's. An Event skips the duties of a Tournament that is not live (193). The gate still
   * decides each one. A duty told before an unpublish is told again.
   */
  async lockedDutiesPublished(eventId: string, tournamentId: string | null): Promise<void> {
    const ids = await lockedDutyIds(this.supabase, eventId, tournamentId);
    await Promise.all(ids.map((id) => this.assignmentChanged(id, { resend: true })));
  }

  /**
   * The referee's lock message. `resend`: sent again on purpose, past the job its first send left
   * (ruling 186: one the send gate dropped still holds its job id for a day).
   */
  async assignmentChanged(assignmentId: string, { resend = false } = {}): Promise<void> {
    const { data: assignment } = await this.supabase.service
      .from('referee_assignments')
      .select('id, person_id, role, matches ( match_number_label )')
      .eq('id', assignmentId)
      .maybeSingle();
    if (!assignment) return;

    const row = assignment as {
      id: string;
      person_id: string | null;
      role: string | null;
      matches?: { match_number_label?: string | null } | null;
    };
    if (!row.person_id) return;

    const contact = await this.refereeAccount(row.id, row.person_id);
    if (!contact) return;

    const message: ScheduledNotificationJob = {
      kind: 'assignment_changed',
      entityId: row.id,
      userId: contact.userId,
      ...texts.lockMessage(row.role, row.matches?.match_number_label),
      url: '/notifications',
      email: contact.email,
      preference: 'schedule_changes',
    };
    await this.scheduler.sendImmediate(message, { replace: resend });
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
          ...texts.workshopCancelled(title),
          url: '/notifications',
          email: contact.email,
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
      ...texts.waitlistPromoted(title),
      url: '/notifications',
      email: contact.email,
    });
  }

  async resultsPublished(tournamentId: string): Promise<void> {
    const { data: tournament, error } = await this.supabase.service
      .from('tournaments')
      .select('id, name, status, events(status, event_kind)')
      .eq('id', tournamentId)
      .maybeSingle();
    if (error) throw new Error(`Results notice: Tournament read failed: ${error.message}`);
    // Not for a draft or test Event (rulings 196, 197). Asked before a job exists: see `CHECKS`.
    if (!isPublicTournamentEmbed(tournament))
      return this.logger.log(`Dropped results_published for ${tournamentId}: hidden or gone`);

    const text = texts.resultsPublished((tournament as { name: string }).name);
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
          ...text,
          url: '/notifications',
          email: contact.email,
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
   * Suppressed unless the Tournament and its Event are public (ruling 198): trying
   * the format out in a draft, or in a test Event, must not message the whole field.
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
          ...texts.swissRound(round.tournamentName, round.roundNumber),
          body: round.opponentLine(registrationId),
          url: round.url,
          email: contact.email,
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
   * Called ONLY after the compare-and-set in EventsService.writePublishedEvent
   * (publishEvent and updateEvent), which stamps events.first_published_at and
   * so guarantees this runs at most once per event. That guard lives in the DB rather than here
   * because BullMQ's jobId dedupe expires with removeOnComplete (24h), and an
   * unpublish/republish a week later would otherwise re-spam every follower.
   *
   * The follower read is inlined rather than delegated to
   * OrganizationFollowsService so NotificationsModule does not have to depend
   * on FollowsModule for one select.
   */
  async organizerPublishedEvent(eventId: string): Promise<void> {
    const { data: event } = await this.supabase.service
      .from('events')
      .select('id, name, slug, city, start_date, event_kind, organization_id')
      .eq('id', eventId)
      .maybeSingle();
    const row = event as {
      id: string;
      name: string;
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
    const orgName = (org as { name?: string | null } | null)?.name;

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

    // Each follower's own account address, in one read (ruling 215). Not a roster row's: a
    // follower may be on no roster. An account with no address is told by push only, if it has one.
    const emailByUser = await accountEmails(
      { supabase: this.supabase, logger: this.logger },
      followerIds,
      `New-Event notice of ${eventId}`,
    );

    const detail = [row.start_date, row.city].filter(Boolean).join(' · ');
    const text = texts.newEvent(orgName, row.name, detail);
    const url = row.slug ? `/e/${row.slug}/home` : '/';

    await this.scheduler.sendImmediateBulk(
      followerIds.map((userId) => ({
        kind: 'organizer_published_event' as const,
        entityId: eventId,
        userId,
        ...text,
        url,
        email: emailByUser.get(userId) ?? null,
        preference: 'organizer_updates' as const,
      })),
    );
  }

  private async getWorkshopTitle(sessionId: string): Promise<string | null> {
    const { data: session } = await this.supabase.service
      .from('workshop_sessions')
      .select('id, workshops ( title )')
      .eq('id', sessionId)
      .maybeSingle();
    const workshop = (session as { workshops?: { title?: string | null } | null } | null)
      ?.workshops;
    return workshop?.title ?? null;
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
   * The account behind a duty's referee: the one that holds his profile, with that account's own
   * address (rulings 201, 201a). Not his roster row in the Event: a referee from the directory has
   * none. Not the profile's address: an organiser may have typed it, and nothing keeps it current.
   */
  private async refereeAccount(
    dutyId: string,
    globalPersonId: string,
  ): Promise<{ userId: string; email: string | null } | null> {
    const { data, error } = await this.supabase.service
      .from('global_persons')
      .select('claimed_by_user_id')
      .eq('id', globalPersonId)
      .maybeSingle();
    if (error) this.logger.warn(`Lock message of ${dutyId}: profile unreadable: ${error.message}`);
    const userId = (data as { claimed_by_user_id: string | null } | null)?.claimed_by_user_id;
    if (!userId) return null;
    const { status, data: account } = await this.supabase.getAuthAdminUser(userId);
    if (!account) this.logger.warn(`Lock message of ${dutyId}: account unreadable: ${status}`);
    return { userId, email: account?.email ?? null };
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
