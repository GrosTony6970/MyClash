import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { NotificationSchedulerService } from '../../workers/notification-scheduler.worker';
import { OrganizationsService } from '../organizations/organizations.service';
import { SupabaseService } from '../supabase/supabase.service';
import type { SendBroadcastNotificationDto } from './dto/notifications.dto';

export type BroadcastSeverity = 'info' | 'warning' | 'alert';
export type BroadcastTargetType =
  | 'all'
  | 'fighters'
  | 'referees'
  | 'fighters_and_referees'
  | 'specific_persons';

interface EventRow {
  id: string;
  organization_id: string;
  slug?: string | null;
  name?: string | null;
}

interface PersonRecipient {
  personId: string;
  userId: string | null;
  email: string | null;
}

interface RecipientRow {
  id: string;
  person_id: string | null;
  user_id: string | null;
  email: string | null;
}

const TARGET_TYPES: BroadcastTargetType[] = [
  'all',
  'fighters',
  'referees',
  'fighters_and_referees',
  'specific_persons',
];
const SEVERITIES: BroadcastSeverity[] = ['info', 'warning', 'alert'];

@Injectable()
export class BroadcastNotificationsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly organizations: OrganizationsService,
    private readonly scheduler: NotificationSchedulerService,
  ) {}

  async sendBroadcast(
    eventId: string,
    actorUserId: string,
    dto: SendBroadcastNotificationDto,
  ): Promise<{ id: string; recipientCount: number }> {
    const event = await this.getEvent(eventId);
    await this.organizations.assertOrgRole(event.organization_id, actorUserId, 'admin');

    const title = dto.title?.trim() ?? '';
    const body = dto.body?.trim() ?? '';
    if (!TARGET_TYPES.includes(dto.targetType as BroadcastTargetType)) {
      throw new BadRequestException('Invalid notification target');
    }
    if (!SEVERITIES.includes(dto.severity as BroadcastSeverity)) {
      throw new BadRequestException('Invalid notification severity');
    }
    if (!title || !body) throw new BadRequestException('Title and body are required');

    const recipients = this.dedupeRecipients(await this.resolveRecipients(eventId, dto));
    if (recipients.length === 0) throw new BadRequestException('No recipients matched');

    const { data: broadcast, error: broadcastError } = await this.supabase.service
      .from('event_broadcast_notifications')
      .insert({
        event_id: eventId,
        actor_user_id: actorUserId,
        severity: dto.severity,
        target_type: dto.targetType,
        title,
        body,
        recipient_count: recipients.length,
      })
      .select('id, recipient_count')
      .single();
    if (broadcastError || !broadcast) {
      throw new BadRequestException(broadcastError?.message ?? 'Failed to create broadcast');
    }

    const broadcastId = (broadcast as { id: string }).id;
    const { data: insertedRecipients, error: recipientsError } = await this.supabase.service
      .from('event_broadcast_recipients')
      .insert(
        recipients.map((recipient) => ({
          broadcast_id: broadcastId,
          person_id: recipient.personId,
          user_id: recipient.userId,
          email: recipient.email,
          delivery_status: 'queued',
        })),
      )
      .select('id, person_id, user_id, email');
    if (recipientsError) throw new BadRequestException(recipientsError.message);

    await this.audit(actorUserId, eventId, {
      broadcastId,
      severity: dto.severity,
      targetType: dto.targetType,
      tournamentId: dto.tournamentId ?? null,
      recipientCount: recipients.length,
    });

    await Promise.all(
      ((insertedRecipients ?? []) as RecipientRow[]).map((recipient) =>
        this.scheduler.sendImmediate({
          kind: 'organizer_broadcast',
          entityId: broadcastId,
          recipientId: recipient.id,
          userId: recipient.user_id ?? recipient.id,
          forceEmail: !recipient.user_id,
          title,
          body,
          url: '/notifications',
          email: recipient.email,
          emailSubject: title,
          severity: dto.severity,
        }),
      ),
    );

    return { id: broadcastId, recipientCount: recipients.length };
  }

  async listEventBroadcasts(eventId: string, actorUserId: string) {
    const event = await this.getEvent(eventId);
    await this.organizations.assertOrgRole(event.organization_id, actorUserId, 'admin');

    const { data, error } = await this.supabase.service
      .from('event_broadcast_notifications')
      .select('id, severity, target_type, title, body, recipient_count, created_at')
      .eq('event_id', eventId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new BadRequestException(error.message);
    return (data ?? []).map((row) => this.mapBroadcast(row as Record<string, unknown>));
  }

  async listUserBroadcasts(userId: string) {
    const { data, error } = await this.supabase.service
      .from('event_broadcast_recipients')
      .select(
        'id, delivery_status, delivered_at, event_broadcast_notifications ( id, event_id, severity, target_type, title, body, created_at, events ( slug, name ) )',
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new BadRequestException(error.message);

    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
      const broadcast = row['event_broadcast_notifications'] as Record<string, unknown> | null;
      const event = broadcast?.['events'] as Record<string, unknown> | null;
      return {
        id: row['id'],
        broadcastId: broadcast?.['id'],
        eventId: broadcast?.['event_id'],
        eventSlug: event?.['slug'] ?? null,
        eventName: event?.['name'] ?? null,
        severity: broadcast?.['severity'],
        targetType: broadcast?.['target_type'],
        title: broadcast?.['title'],
        body: broadcast?.['body'],
        createdAt: broadcast?.['created_at'],
        deliveryStatus: row['delivery_status'],
        deliveredAt: row['delivered_at'],
      };
    });
  }

  private async getEvent(eventId: string): Promise<EventRow> {
    const { data, error } = await this.supabase.service
      .from('events')
      .select('id, organization_id, slug, name')
      .eq('id', eventId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Event ${eventId} not found`);
    return data as EventRow;
  }

  private async resolveRecipients(
    eventId: string,
    dto: SendBroadcastNotificationDto,
  ): Promise<PersonRecipient[]> {
    if (dto.targetType === 'all') return this.getPersonsForEvent(eventId);
    if (dto.targetType === 'specific_persons') {
      const personIds = Array.from(new Set(dto.personIds ?? []));
      if (personIds.length === 0) throw new BadRequestException('At least one person is required');
      const persons = await this.getPersonsByIds(eventId, personIds);
      if (persons.length !== personIds.length) {
        throw new BadRequestException('All selected persons must belong to this event');
      }
      return persons;
    }
    if (dto.targetType === 'fighters') return this.getFighterRecipients(eventId, dto.tournamentId);
    if (dto.targetType === 'referees') return this.getRefereeRecipients(eventId, dto.tournamentId);
    const [fighters, referees] = await Promise.all([
      this.getFighterRecipients(eventId, dto.tournamentId),
      this.getRefereeRecipients(eventId, dto.tournamentId),
    ]);
    return [...fighters, ...referees];
  }

  private async getPersonsForEvent(eventId: string): Promise<PersonRecipient[]> {
    const { data, error } = await this.supabase.service
      .from('persons')
      .select('id, claimed_by_user_id, email')
      .eq('event_id', eventId)
      .order('family_name', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return this.mapPersons(data ?? []);
  }

  private async getPersonsByIds(eventId: string, personIds: string[]): Promise<PersonRecipient[]> {
    const { data, error } = await this.supabase.service
      .from('persons')
      .select('id, claimed_by_user_id, email')
      .eq('event_id', eventId)
      .in('id', personIds);
    if (error) throw new BadRequestException(error.message);
    return this.mapPersons(data ?? []);
  }

  private async getTournamentIds(eventId: string, tournamentId?: string): Promise<string[]> {
    if (tournamentId) {
      const { data, error } = await this.supabase.service
        .from('tournaments')
        .select('id')
        .eq('event_id', eventId)
        .eq('id', tournamentId);
      if (error) throw new BadRequestException(error.message);
      if (!data || (data as Array<unknown>).length === 0) {
        throw new BadRequestException('Tournament must belong to this event');
      }
      return [tournamentId];
    }

    const { data, error } = await this.supabase.service
      .from('tournaments')
      .select('id')
      .eq('event_id', eventId);
    if (error) throw new BadRequestException(error.message);
    return ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
  }

  private async getFighterRecipients(
    eventId: string,
    tournamentId?: string,
  ): Promise<PersonRecipient[]> {
    const tournamentIds = await this.getTournamentIds(eventId, tournamentId);
    if (tournamentIds.length === 0) return [];

    const { data: registrations, error: registrationError } = await this.supabase.service
      .from('registrations')
      .select('person_id')
      .in('tournament_id', tournamentIds)
      .in('status', ['registered', 'checked_in', 'done']);
    if (registrationError) throw new BadRequestException(registrationError.message);

    const personIds = Array.from(
      new Set(
        ((registrations ?? []) as Array<{ person_id: string | null }>)
          .map((row) => row.person_id)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    if (personIds.length === 0) return [];
    return this.getPersonsByIds(eventId, personIds);
  }

  private async getRefereeRecipients(
    eventId: string,
    tournamentId?: string,
  ): Promise<PersonRecipient[]> {
    // Post-0063: referee_* tables key on person_id (= global_persons.id).
    // Recipients are still event-scoped persons rows (carry the email +
    // userId), so we resolve global_persons.id → persons row via
    // persons.global_person_id.
    if (tournamentId) {
      await this.getTournamentIds(eventId, tournamentId);
      const { data: phases, error: phasesError } = await this.supabase.service
        .from('phases')
        .select('id')
        .eq('tournament_id', tournamentId);
      if (phasesError) throw new BadRequestException(phasesError.message);
      const phaseIds = ((phases ?? []) as Array<{ id: string }>).map((row) => row.id);
      if (phaseIds.length === 0) return [];

      const [{ data: pools, error: poolsError }, { data: matches, error: matchesError }] =
        await Promise.all([
          this.supabase.service.from('pools').select('id').in('phase_id', phaseIds),
          this.supabase.service.from('matches').select('id').in('phase_id', phaseIds),
        ]);
      if (poolsError) throw new BadRequestException(poolsError.message);
      if (matchesError) throw new BadRequestException(matchesError.message);
      const poolIds = new Set(((pools ?? []) as Array<{ id: string }>).map((row) => row.id));
      const matchIds = new Set(((matches ?? []) as Array<{ id: string }>).map((row) => row.id));

      const { data: assignments, error } = await this.supabase.service
        .from('referee_assignments')
        .select('person_id, pool_id, match_id')
        .eq('event_id', eventId);
      if (error) throw new BadRequestException(error.message);
      const personIds = Array.from(
        new Set(
          (
            (assignments ?? []) as Array<{
              person_id: string | null;
              pool_id: string | null;
              match_id: string | null;
            }>
          )
            .filter(
              (row) =>
                (row.pool_id && poolIds.has(row.pool_id)) ||
                (row.match_id && matchIds.has(row.match_id)),
            )
            .map((row) => row.person_id)
            .filter((id): id is string => Boolean(id)),
        ),
      );
      if (personIds.length === 0) return [];
      return this.resolveRefereeRecipients(eventId, personIds);
    }

    const [{ data: qualifications, error: qualificationError }, { data: assignments, error }] =
      await Promise.all([
        this.supabase.service
          .from('referee_qualifications')
          .select('person_id')
          .eq('event_id', eventId)
          .eq('active', true),
        this.supabase.service
          .from('referee_assignments')
          .select('person_id')
          .eq('event_id', eventId),
      ]);
    if (qualificationError) throw new BadRequestException(qualificationError.message);
    if (error) throw new BadRequestException(error.message);

    const personIds = Array.from(
      new Set(
        [
          ...((qualifications ?? []) as Array<{ person_id: string | null }>),
          ...((assignments ?? []) as Array<{ person_id: string | null }>),
        ]
          .map((row) => row.person_id)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    if (personIds.length === 0) return [];
    return this.resolveRefereeRecipients(eventId, personIds);
  }

  /**
   * Resolve a list of global_persons.id (post-0063 referee identity) to
   * `PersonRecipient`s with email addresses. Picks the event-scoped
   * `persons` row when one exists (it carries the per-event email +
   * claimed_by_user_id); falls back to global_persons for unclaimed
   * referees who don't have an event-scoped row yet.
   */
  private async resolveRefereeRecipients(
    eventId: string,
    personIds: string[],
  ): Promise<PersonRecipient[]> {
    if (personIds.length === 0) return [];

    const { data: persons, error: personsError } = await this.supabase.service
      .from('persons')
      .select('id, global_person_id, claimed_by_user_id, email')
      .eq('event_id', eventId)
      .in('global_person_id', personIds);
    if (personsError) throw new BadRequestException(personsError.message);

    const personsByGlobal = new Map<string, PersonRecipient>();
    for (const row of (persons ?? []) as Array<{
      id: string;
      global_person_id: string | null;
      claimed_by_user_id: string | null;
      email: string | null;
    }>) {
      if (!row.global_person_id) continue;
      personsByGlobal.set(row.global_person_id, {
        personId: row.id,
        userId: row.claimed_by_user_id ?? null,
        email: row.email ?? null,
      });
    }

    const missing = personIds.filter((id) => !personsByGlobal.has(id));
    if (missing.length > 0) {
      const { data: gpRows } = await this.supabase.service
        .from('global_persons')
        .select('id, claimed_by_user_id')
        .in('id', missing);
      for (const gp of (gpRows ?? []) as Array<{
        id: string;
        claimed_by_user_id: string | null;
      }>) {
        personsByGlobal.set(gp.id, {
          personId: gp.id,
          userId: gp.claimed_by_user_id ?? null,
          email: null,
        });
      }
    }

    return Array.from(personsByGlobal.values());
  }

  private mapPersons(rows: unknown[]): PersonRecipient[] {
    return (rows as Array<Record<string, unknown>>).map((row) => ({
      personId: String(row['id']),
      userId: typeof row['claimed_by_user_id'] === 'string' ? row['claimed_by_user_id'] : null,
      email: typeof row['email'] === 'string' ? row['email'] : null,
    }));
  }

  private dedupeRecipients(recipients: PersonRecipient[]): PersonRecipient[] {
    const seen = new Set<string>();
    const deduped: PersonRecipient[] = [];
    for (const recipient of recipients) {
      const key = recipient.userId
        ? `user:${recipient.userId}`
        : recipient.email
          ? `email:${recipient.email.toLowerCase()}`
          : `person:${recipient.personId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(recipient);
    }
    return deduped;
  }

  private async audit(actorUserId: string, eventId: string, payload: Record<string, unknown>) {
    await this.supabase.service.from('audit_log').insert({
      actor_user_id: actorUserId,
      action: 'event.broadcast_notification_sent',
      entity_type: 'event',
      entity_id: eventId,
      payload_json: payload,
    });
  }

  private mapBroadcast(row: Record<string, unknown>) {
    return {
      id: row['id'],
      severity: row['severity'],
      targetType: row['target_type'],
      title: row['title'],
      body: row['body'],
      recipientCount: row['recipient_count'],
      createdAt: row['created_at'],
    };
  }
}
