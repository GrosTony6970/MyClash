import { BadRequestException, Injectable } from '@nestjs/common';
import { OrganizationsService } from '../organizations/organizations.service';
import { SupabaseService } from '../supabase/supabase.service';
import {
  buildClockReconciliation,
  type ClockReconciliationReport,
  type ExchangeClockRow,
  type MatchEnvelope,
  type StaffClockRow,
} from './clock-reconciliation';

/**
 * Gathering only — every rule lives in `clock-reconciliation.ts`.
 *
 * Its own service rather than more of `events.service.ts`, which is past 4000
 * lines and already on the over-400 allowlist. This one answers a single
 * question and reads four tables to do it.
 */
@Injectable()
export class ClockReconciliationService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly orgs: OrganizationsService,
  ) {}

  /**
   * Can the timings on this event's results be trusted?
   *
   * Same `scorekeeper` bar as the readiness checklist: this is organiser detail
   * about their own event's equipment, not a platform concern. Deliberately NOT
   * wired into `admin/review-queue`, which is `@PlatformRole('platform_admin')`
   * — a tablet with a wrong clock is a thing the organiser standing in the hall
   * fixes, and routing venue operations to platform admins would bury it.
   */
  async getReport(eventId: string, userId: string): Promise<ClockReconciliationReport> {
    const { data: event, error: eventErr } = await this.supabase.service
      .from('events')
      .select('id,organization_id')
      .eq('id', eventId)
      .maybeSingle();
    if (eventErr) throw new BadRequestException(eventErr.message);
    const organizationId = (event as { organization_id: string } | null)?.organization_id;
    if (!organizationId) throw new BadRequestException('Event not found');
    await this.orgs.assertOrgRole(organizationId, userId, 'scorekeeper');

    const staff = await this.staffClocks(eventId);
    if (staff.length === 0) return { rows: [], needsAttention: 0, hasUnmeasured: false };

    const exchanges = await this.exchangeClocks(staff.map((account) => account.id));
    const envelopes = await this.matchEnvelopes([
      ...new Set(exchanges.map((exchange) => exchange.match_id)),
    ]);
    return buildClockReconciliation(staff, exchanges, envelopes);
  }

  private async staffClocks(eventId: string): Promise<StaffClockRow[]> {
    const { data, error } = await this.supabase.service
      .from('event_staff_accounts')
      .select('id,username,clock_skew_ms,last_seen_at')
      .eq('event_id', eventId)
      .order('username', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as StaffClockRow[];
  }

  /**
   * The tablet-stamped timestamps, beside the server-stamped ones.
   *
   * Scoped by staff account rather than by event because `exchanges` has no
   * event_id — the accounts are already event-scoped, so filtering on them is
   * both correct and one hop shorter than going through matches and phases.
   */
  private async exchangeClocks(staffAccountIds: string[]): Promise<ExchangeClockRow[]> {
    if (staffAccountIds.length === 0) return [];
    const { data, error } = await this.supabase.service
      .from('exchanges')
      .select('match_id,staff_account_id,occurred_at,recorded_at')
      .in('staff_account_id', staffAccountIds);
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as ExchangeClockRow[];
  }

  /**
   * Each bout's start and end, from `match_events`.
   *
   * These are SERVER-stamped — every writer inserts `new Date()` — which is the
   * whole reason the envelope check is worth anything: it is the one comparison
   * in the report with no queue latency mixed into it. Note this contradicts
   * migration 0172's header, which claims these carry the tablet's clock; the
   * writers are the truth and the header is stale.
   */
  private async matchEnvelopes(matchIds: string[]): Promise<MatchEnvelope[]> {
    if (matchIds.length === 0) return [];
    const { data, error } = await this.supabase.service
      .from('match_events')
      .select('match_id,type,occurred_at')
      .in('match_id', matchIds)
      .in('type', ['start', 'end'])
      .order('occurred_at', { ascending: true });
    if (error) throw new BadRequestException(error.message);

    const byMatch = new Map<string, MatchEnvelope>();
    for (const row of (data ?? []) as Array<{
      match_id: string;
      type: string;
      occurred_at: string;
    }>) {
      const envelope = byMatch.get(row.match_id) ?? {
        matchId: row.match_id,
        startedAt: null,
        endedAt: null,
      };
      // Ordered ascending, so the FIRST start and the LAST end win — a bout
      // restarted by an organiser has several of each, and the widest window is
      // the one that cannot produce a false anomaly.
      if (row.type === 'start') envelope.startedAt ??= row.occurred_at;
      else envelope.endedAt = row.occurred_at;
      byMatch.set(row.match_id, envelope);
    }
    return [...byMatch.values()];
  }
}
