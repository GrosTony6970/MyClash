import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import type { SubscribeDto } from './dto/notifications.dto';

export interface SubscriptionResponse {
  id: string;
  endpoint: string;
}

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
}
