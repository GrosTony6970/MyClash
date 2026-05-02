import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import type { SubscribeDto, UpdateNotificationPreferencesDto } from './dto/notifications.dto';

export interface SubscriptionResponse {
  id: string;
  endpoint: string;
}

export interface NotificationPreferencesResponse {
  matchStartingMinutesBefore: number;
  workshopStartingMinutesBefore: number;
  refereeStartingMinutesBefore: number;
  scheduleChanges: boolean;
  resultsPublished: boolean;
  enabled: boolean;
}

const DEFAULT_PREFERENCES: NotificationPreferencesResponse = {
  matchStartingMinutesBefore: 10,
  workshopStartingMinutesBefore: 15,
  refereeStartingMinutesBefore: 10,
  scheduleChanges: true,
  resultsPublished: true,
  enabled: true,
};

@Injectable()
export class NotificationsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
  ) {}

  getVapidPublicKey(): { publicKey: string } {
    const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY')?.trim();
    if (!publicKey) {
      throw new BadRequestException('VAPID_PUBLIC_KEY is not configured');
    }
    return { publicKey };
  }

  async subscribe(
    userId: string,
    dto: SubscribeDto,
    userAgent: string | undefined,
  ): Promise<SubscriptionResponse> {
    const deleteResult = await this.supabase.service
      .from('push_subscriptions')
      .delete()
      .eq('user_id', userId)
      .eq('endpoint', dto.endpoint);

    if (deleteResult.error) {
      throw new BadRequestException(deleteResult.error.message);
    }

    const { data, error } = await this.supabase.service
      .from('push_subscriptions')
      .insert({
        user_id: userId,
        endpoint: dto.endpoint,
        p256dh_key: dto.keys.p256dh,
        auth_key: dto.keys.auth,
        user_agent: userAgent ?? null,
        last_seen_at: new Date().toISOString(),
      })
      .select('id, endpoint')
      .single();

    if (error) {
      throw new BadRequestException(error.message);
    }

    return data as SubscriptionResponse;
  }

  async unsubscribe(userId: string, id: string): Promise<{ deleted: true }> {
    const { error } = await this.supabase.service
      .from('push_subscriptions')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) {
      throw new BadRequestException(error.message);
    }

    return { deleted: true };
  }

  async getPreferences(userId: string): Promise<NotificationPreferencesResponse> {
    const { data, error } = await this.supabase.service
      .from('notification_preferences')
      .select(
        'match_starting_minutes_before, workshop_starting_minutes_before, referee_starting_minutes_before, schedule_changes, results_published, enabled',
      )
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    return this.mapPreferences(data as Record<string, unknown> | null);
  }

  async updatePreferences(
    userId: string,
    dto: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferencesResponse> {
    const patch: Record<string, unknown> = {
      user_id: userId,
    };

    if (dto.matchStartingMinutesBefore !== undefined) {
      patch['match_starting_minutes_before'] = String(dto.matchStartingMinutesBefore);
    }
    if (dto.workshopStartingMinutesBefore !== undefined) {
      patch['workshop_starting_minutes_before'] = String(dto.workshopStartingMinutesBefore);
    }
    if (dto.refereeStartingMinutesBefore !== undefined) {
      patch['referee_starting_minutes_before'] = String(dto.refereeStartingMinutesBefore);
    }
    if (dto.scheduleChanges !== undefined) patch['schedule_changes'] = dto.scheduleChanges;
    if (dto.resultsPublished !== undefined) patch['results_published'] = dto.resultsPublished;
    if (dto.enabled !== undefined) patch['enabled'] = dto.enabled;

    const { data, error } = await this.supabase.service
      .from('notification_preferences')
      .upsert(patch, { onConflict: 'user_id' })
      .select(
        'match_starting_minutes_before, workshop_starting_minutes_before, referee_starting_minutes_before, schedule_changes, results_published, enabled',
      )
      .single();

    if (error) throw new BadRequestException(error.message);
    return this.mapPreferences(data as Record<string, unknown> | null);
  }

  private mapPreferences(row: Record<string, unknown> | null): NotificationPreferencesResponse {
    if (!row) return DEFAULT_PREFERENCES;

    return {
      matchStartingMinutesBefore: this.toMinutes(
        row['match_starting_minutes_before'],
        DEFAULT_PREFERENCES.matchStartingMinutesBefore,
      ),
      workshopStartingMinutesBefore: this.toMinutes(
        row['workshop_starting_minutes_before'],
        DEFAULT_PREFERENCES.workshopStartingMinutesBefore,
      ),
      refereeStartingMinutesBefore: this.toMinutes(
        row['referee_starting_minutes_before'],
        DEFAULT_PREFERENCES.refereeStartingMinutesBefore,
      ),
      scheduleChanges:
        typeof row['schedule_changes'] === 'boolean'
          ? row['schedule_changes']
          : DEFAULT_PREFERENCES.scheduleChanges,
      resultsPublished:
        typeof row['results_published'] === 'boolean'
          ? row['results_published']
          : DEFAULT_PREFERENCES.resultsPublished,
      enabled: typeof row['enabled'] === 'boolean' ? row['enabled'] : DEFAULT_PREFERENCES.enabled,
    };
  }

  private toMinutes(value: unknown, fallback: number): number {
    const parsed =
      typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }
}
