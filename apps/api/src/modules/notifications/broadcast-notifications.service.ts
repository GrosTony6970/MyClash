import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { NotificationSchedulerService } from '../../workers/notification-scheduler.worker';
import { OrganizationsService } from '../organizations/organizations.service';
import { SupabaseService } from '../supabase/supabase.service';
import type { SendBroadcastNotificationDto } from './dto/notifications.dto';

export type BroadcastSeverity = 'info' | 'warning' | 'alert';
export type BroadcastTargetType = 'all' | 'fighters' | 'referees' | 'specific_persons';

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

const TARGET_TYPES: BroadcastTargetType[] = ['all', 'fighters', 'referees', 'specific_persons'];
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
    if (dto.targetType === 'fighters') return this.getFighterRecipients(eventId);
    return this.getRefereeRecipients(eventId);
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

  private async getFighterRecipients(eventId: string): Promise<PersonRecipient[]> {
    const { data: tournaments, error: tournamentError } = await this.supabase.service
      .from('tournaments')
      .select('id')
      .eq('event_id', eventId);
    if (tournamentError) throw new BadRequestException(tournamentError.message);
    const tournamentIds = ((tournaments ?? []) as Array<{ id: string }>).map((row) => row.id);
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

  private async getRefereeRecipients(eventId: string): Promise<PersonRecipient[]> {
    const [{ data: qualifications, error: qualificationError }, { data: assignments, error }] =
      await Promise.all([
        this.supabase.service
          .from('referee_qualifications')
          .select('user_id')
          .eq('event_id', eventId)
          .eq('active', true),
        this.supabase.service.from('referee_assignments').select('user_id').eq('event_id', eventId),
      ]);
    if (qualificationError) throw new BadRequestException(qualificationError.message);
    if (error) throw new BadRequestException(error.message);

    const userIds = Array.from(
      new Set(
        [
          ...((qualifications ?? []) as Array<{ user_id: string | null }>),
          ...((assignments ?? []) as Array<{ user_id: string | null }>),
        ]
          .map((row) => row.user_id)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    if (userIds.length === 0) return [];

    const { data: persons, error: personsError } = await this.supabase.service
      .from('persons')
      .select('id, claimed_by_user_id, email')
      .eq('event_id', eventId)
      .in('claimed_by_user_id', userIds);
    if (personsError) throw new BadRequestException(personsError.message);
    return this.mapPersons(persons ?? []);
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
