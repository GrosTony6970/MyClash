/**
 * notifications-summary.service.ts — aggregate counts for the super-admin
 * notification bell + the Review Queue sidebar badge.
 *
 * Polled every 60 s by the web-admin shell, so every count source uses
 * Supabase's `head: true, count: 'exact'` to avoid pulling row data.
 * Tolerant to a missing source: any table that errors (e.g. partial
 * fresh deploy where a migration hasn't landed) contributes 0 and a
 * `logger.warn`, so the bell still surfaces surviving counts.
 */

import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { ReviewQueueService } from './review-queue.service';

export interface NotificationsSummary {
  /** Pending items across the six review-queue sources. */
  reviewQueue: number;
  /** event_broadcast_recipients with delivery_status = 'failed'. */
  broadcastFailures: number;
  /** ai_data_quality_findings status='open' AND severity IN ('critical','high'). */
  aiFindings: number;
  /** ai_data_quality_scans status='failed'. */
  aiScanCrashes: number;
  /** Sum of the four counts above — drives the bell pill. */
  total: number;
}

@Injectable()
export class NotificationsSummaryService {
  private readonly logger = new Logger(NotificationsSummaryService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly reviewQueue: ReviewQueueService,
  ) {}

  async getSummary(): Promise<NotificationsSummary> {
    const [reviewQueue, broadcastFailures, aiFindings, aiScanCrashes] = await Promise.all([
      this.reviewQueue.countPending().catch((err: unknown) => {
        this.logger.warn(`reviewQueue count failed — ${asMessage(err)}; returning 0.`);
        return 0;
      }),
      this.countBroadcastFailures(),
      this.countAiFindings(),
      this.countAiScanCrashes(),
    ]);

    return {
      reviewQueue,
      broadcastFailures,
      aiFindings,
      aiScanCrashes,
      total: reviewQueue + broadcastFailures + aiFindings + aiScanCrashes,
    };
  }

  private async countBroadcastFailures(): Promise<number> {
    const { count, error } = await this.supabase.service
      .from('event_broadcast_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('delivery_status', 'failed');
    if (error) {
      this.logger.warn(`event_broadcast_recipients count failed — ${error.message}; returning 0.`);
      return 0;
    }
    return count ?? 0;
  }

  private async countAiFindings(): Promise<number> {
    const { count, error } = await this.supabase.service
      .from('ai_data_quality_findings')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open')
      .in('severity', ['critical', 'high']);
    if (error) {
      this.logger.warn(`ai_data_quality_findings count failed — ${error.message}; returning 0.`);
      return 0;
    }
    return count ?? 0;
  }

  private async countAiScanCrashes(): Promise<number> {
    const { count, error } = await this.supabase.service
      .from('ai_data_quality_scans')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'failed');
    if (error) {
      this.logger.warn(`ai_data_quality_scans count failed — ${error.message}; returning 0.`);
      return 0;
    }
    return count ?? 0;
  }
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
