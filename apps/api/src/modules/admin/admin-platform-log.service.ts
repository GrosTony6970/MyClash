/**
 * admin-platform-log.service.ts — the "Platform Log" aggregator behind the
 * super-admin notification bell.
 *
 * Normalises several operational sources (AI scan crashes, AI findings,
 * broadcast delivery failures, club reviews, AI usage, AI drafts, deletion
 * requests, profile merges, club archiving) into a single chronological feed.
 *
 * Strategy (bounded-window merge-in-memory — same shape as
 * ReviewQueueService.listAll, chosen for low-volume admin data):
 *   1. Query each active source with `PER_SOURCE_CAP` rows + optional date window.
 *   2. Normalise each row → PlatformLogEntry (raw, actor unresolved).
 *   3. Merge, apply the severity filter, sort by occurredAt desc.
 *   4. Slice to the requested page; resolve actors for that page only.
 * `total` is window-scoped (not a global DB count); `truncated` is true when any
 * source hit its cap. A per-`category` filter narrows to one source, which then
 * paginates cleanly against the DB. The documented upgrade path (if a source —
 * e.g. ai_usage — becomes noisy) is a SQL union view with a real global count.
 *
 * Tolerant to a missing/erroring source: each contributes `[]` + a `logger.warn`
 * so a partial deploy never 500s the endpoint (mirrors NotificationsSummaryService).
 */

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { UserDirectoryService } from '../user-directory/user-directory.service';
import type { ListPlatformLogQueryDto } from './dto/admin-platform-log.dto';

export type PlatformLogCategory =
  | 'ai_scan'
  | 'ai_finding'
  | 'broadcast_failure'
  | 'club_review'
  | 'ai_usage'
  | 'ai_draft'
  | 'deletion'
  | 'merge'
  | 'club_archive'
  | 'query_error';

export type PlatformLogSeverity = 'info' | 'warning' | 'error';

export interface PlatformLogEntry {
  /** Source-prefixed so React keys never collide across tables, e.g. "ai_scan:<uuid>". */
  id: string;
  category: PlatformLogCategory;
  severity: PlatformLogSeverity;
  /** ISO timestamp; drives the merge-sort and the FE display. */
  occurredAt: string;
  /**
   * Raw data value (finding_type, broadcast title, club/feature name). Null when
   * the source has no meaningful title — the FE falls back to the category label.
   */
  title: string | null;
  detail: string | null;
  /**
   * Raw actor id — never rendered (mirrors the audit endpoint's `actor_user_id`);
   * the FE uses it only to distinguish "unresolved user" from "no user actor".
   * Null when the category has no user actor.
   */
  actorUserId: string | null;
  /** Resolved so the operator never reads a raw UUID. Null when no user actor. */
  actorName: string | null;
  actorEmail: string | null;
  href: string | null;
  /**
   * How many times this entry has happened, for the aggregated sources.
   *
   * A NUMBER, not a sentence: composing "N occurrences since ..." here would
   * hardcode English and break hard rule 6. The panel formats it.
   *
   * Only `query_error` populates these today; every other source is one row per
   * event, where the count is always 1 and `firstSeenAt` equals `occurredAt`.
   */
  occurrenceCount?: number;
  firstSeenAt?: string;
  /** True when the operator can silence this entry. `query_error` only. */
  resolvable?: boolean;
}

export interface PlatformLogListResponse {
  items: PlatformLogEntry[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  /** True when any source returned exactly its cap — older events may be hidden. */
  truncated: boolean;
}

/** Raw entry before actor resolution — actorName/actorEmail filled in after the batch resolve. */
type RawEntry = Omit<PlatformLogEntry, 'actorName' | 'actorEmail'>;

const ALL_CATEGORIES: PlatformLogCategory[] = [
  'ai_scan',
  'ai_finding',
  'broadcast_failure',
  'club_review',
  'ai_usage',
  'ai_draft',
  'deletion',
  'merge',
  'club_archive',
  'query_error',
];

const DEFAULT_PAGE = 1;
const DEFAULT_PER_PAGE = 50;
const MAX_PER_PAGE = 100;
/** Per-source row cap for the merged window. Keeps the in-memory merge cheap. */
const PER_SOURCE_CAP = 200;
/** See fetchQueryErrors: aggregated source, so it needs far fewer slots. */
const QUERY_ERROR_CAP = 50;

function positiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function assertDate(value: string | undefined, name: string): void {
  if (value && Number.isNaN(Date.parse(value))) {
    throw new BadRequestException(`${name} must be a valid date`);
  }
}

/** Normalise a PostgREST embed that may arrive as an object or a single-element array. */
function firstOf<T>(embed: T | T[] | null | undefined): T | null {
  if (Array.isArray(embed)) return embed[0] ?? null;
  return embed ?? null;
}

@Injectable()
export class AdminPlatformLogService {
  private readonly logger = new Logger(AdminPlatformLogService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly userDirectory: UserDirectoryService,
  ) {}

  async list(query: ListPlatformLogQueryDto): Promise<PlatformLogListResponse> {
    assertDate(query.from, 'from');
    assertDate(query.to, 'to');

    const page = positiveInt(query.page, DEFAULT_PAGE);
    const perPage = Math.min(positiveInt(query.perPage, DEFAULT_PER_PAGE), MAX_PER_PAGE);

    // A category filter narrows to a single source (which paginates cleanly);
    // an unknown category simply matches no source → empty feed.
    const activeCategories = query.category
      ? ALL_CATEGORIES.filter((c) => c === query.category)
      : ALL_CATEGORIES;

    const from = query.from;
    const to = query.to;

    const perSource = await Promise.all(
      activeCategories.map((category) =>
        this.fetchSource(category, from, to).catch((err: unknown) => {
          this.logger.warn(`platform-log source ${category} failed — ${asMessage(err)}; skipping.`);
          return [] as RawEntry[];
        }),
      ),
    );

    const truncated = perSource.some((rows) => rows.length >= PER_SOURCE_CAP);

    let merged = perSource.flat();
    if (query.severity) merged = merged.filter((e) => e.severity === query.severity);
    merged.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0));

    const total = merged.length;
    const start = (page - 1) * perPage;
    const pageRows = merged.slice(start, start + perPage);

    const actorMap = await this.userDirectory.resolveUsers([
      ...new Set(pageRows.map((r) => r.actorUserId).filter((id): id is string => Boolean(id))),
    ]);

    const items: PlatformLogEntry[] = pageRows.map((r) => {
      const actor = r.actorUserId ? actorMap.get(r.actorUserId) : null;
      return { ...r, actorName: actor?.name ?? null, actorEmail: actor?.email ?? null };
    });

    return {
      items,
      total,
      page,
      perPage,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
      truncated,
    };
  }

  private fetchSource(
    category: PlatformLogCategory,
    from: string | undefined,
    to: string | undefined,
  ): Promise<RawEntry[]> {
    switch (category) {
      case 'ai_scan':
        return this.fetchAiScans(from, to);
      case 'ai_finding':
        return this.fetchAiFindings(from, to);
      case 'broadcast_failure':
        return this.fetchBroadcastFailures(from, to);
      case 'club_review':
        return this.fetchClubReviews(from, to);
      case 'ai_usage':
        return this.fetchAiUsage(from, to);
      case 'ai_draft':
        return this.fetchAiDrafts(from, to);
      case 'deletion':
        return this.fetchDeletions(from, to);
      case 'merge':
        return this.fetchMerges(from, to);
      case 'query_error':
        return this.fetchQueryErrors(from, to);
      case 'club_archive':
        return this.fetchClubArchives(from, to);
    }
  }

  // ── Sources ────────────────────────────────────────────────────────────────

  /**
   * Queries that errored while their caller may have rendered "no data".
   *
   * Unresolved rows only: a tripwire the operator cannot silence gets ignored,
   * and `record_query_error` un-resolves a fingerprint the moment it recurs.
   *
   * Capped below PER_SOURCE_CAP because this source is AGGREGATED — one row per
   * distinct defect, not per occurrence — so it needs far fewer slots than a log
   * table, and a burst of novel fingerprints must not crowd the other nine
   * sources out of the merged window.
   */
  private async fetchQueryErrors(
    fromDate: string | undefined,
    toDate: string | undefined,
  ): Promise<RawEntry[]> {
    let q = this.supabase.service
      .from('query_error_events')
      .select(
        'id, table_name, is_rpc, status, pg_code, severity, sanitized_path, sanitized_message, first_seen_at, last_seen_at, occurrence_count',
      )
      .is('resolved_at', null);
    if (fromDate) q = q.gte('last_seen_at', fromDate) as typeof q;
    if (toDate) q = q.lte('last_seen_at', toDate) as typeof q;

    const { data, error } = await q
      .order('last_seen_at', { ascending: false })
      .limit(QUERY_ERROR_CAP);
    if (error) return this.warnEmpty('query_error_events', error.message);

    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: `query_error:${r['id'] as string}`,
      category: 'query_error' as const,
      // The table's own CHECK allows only 'error' | 'warning', both of which are
      // PlatformLogSeverity members.
      severity: r['severity'] as PlatformLogSeverity,
      // last_seen_at, not first_seen_at: a three-week-old defect still firing
      // now belongs at the top of the feed, not buried three weeks down it.
      occurredAt: r['last_seen_at'] as string,
      title: `${r['table_name'] as string} · ${String(r['status'])}${
        r['pg_code'] ? ` ${r['pg_code'] as string}` : ''
      }`,
      detail: (r['sanitized_message'] as string | null) ?? (r['sanitized_path'] as string),
      // No user actor: the API itself made this query.
      actorUserId: null,
      href: null,
      occurrenceCount: Number(r['occurrence_count'] ?? 1),
      firstSeenAt: r['first_seen_at'] as string,
      resolvable: true,
    }));
  }

  private async fetchAiScans(
    fromDate: string | undefined,
    toDate: string | undefined,
  ): Promise<RawEntry[]> {
    let q = this.supabase.service
      .from('ai_data_quality_scans')
      .select('id, actor_user_id, error_message, started_at, completed_at')
      .eq('status', 'failed');
    if (fromDate) q = q.gte('started_at', fromDate) as typeof q;
    if (toDate) q = q.lte('started_at', toDate) as typeof q;

    const { data, error } = await q.order('started_at', { ascending: false }).limit(PER_SOURCE_CAP);
    if (error) return this.warnEmpty('ai_data_quality_scans', error.message);

    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: `ai_scan:${r['id'] as string}`,
      category: 'ai_scan',
      severity: 'error',
      occurredAt: (r['completed_at'] as string | null) ?? (r['started_at'] as string),
      title: null,
      detail: (r['error_message'] as string | null) ?? null,
      actorUserId: (r['actor_user_id'] as string | null) ?? null,
      href: '/admin/data-quality',
    }));
  }

  private async fetchAiFindings(
    fromDate: string | undefined,
    toDate: string | undefined,
  ): Promise<RawEntry[]> {
    let q = this.supabase.service
      .from('ai_data_quality_findings')
      .select('id, finding_type, severity, ai_summary, created_at')
      .eq('status', 'open')
      .in('severity', ['critical', 'high']);
    if (fromDate) q = q.gte('created_at', fromDate) as typeof q;
    if (toDate) q = q.lte('created_at', toDate) as typeof q;

    const { data, error } = await q.order('created_at', { ascending: false }).limit(PER_SOURCE_CAP);
    if (error) return this.warnEmpty('ai_data_quality_findings', error.message);

    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: `ai_finding:${r['id'] as string}`,
      category: 'ai_finding',
      severity: r['severity'] === 'critical' ? 'error' : 'warning',
      occurredAt: r['created_at'] as string,
      title: (r['finding_type'] as string | null) ?? null,
      detail: (r['ai_summary'] as string | null) ?? null,
      actorUserId: null,
      href: '/admin/data-quality',
    }));
  }

  private async fetchBroadcastFailures(
    fromDate: string | undefined,
    toDate: string | undefined,
  ): Promise<RawEntry[]> {
    let q = this.supabase.service
      .from('event_broadcast_recipients')
      .select('id, error, email, created_at, event_broadcast_notifications(title)')
      .eq('delivery_status', 'failed');
    if (fromDate) q = q.gte('created_at', fromDate) as typeof q;
    if (toDate) q = q.lte('created_at', toDate) as typeof q;

    const { data, error } = await q.order('created_at', { ascending: false }).limit(PER_SOURCE_CAP);
    if (error) return this.warnEmpty('event_broadcast_recipients', error.message);

    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
      const notif = firstOf(r['event_broadcast_notifications'] as { title: string } | null);
      const detail = [r['error'] as string | null, r['email'] as string | null]
        .filter(Boolean)
        .join(' · ');
      return {
        id: `broadcast_failure:${r['id'] as string}`,
        category: 'broadcast_failure',
        severity: 'error',
        occurredAt: r['created_at'] as string,
        title: notif?.title ?? null,
        detail: detail || null,
        actorUserId: null,
        href: null,
      };
    });
  }

  private async fetchClubReviews(
    fromDate: string | undefined,
    toDate: string | undefined,
  ): Promise<RawEntry[]> {
    // club_review_requests has two FKs to clubs (proposed_club_id +
    // linked_existing_club_id) — the `!proposed_club_id` hint disambiguates the
    // embed. Result lands under the `clubs` key.
    let q = this.supabase.service
      .from('club_review_requests')
      .select(
        'id, status, review_notes, requester_user_id, created_at, clubs!proposed_club_id(name)',
      );
    if (fromDate) q = q.gte('created_at', fromDate) as typeof q;
    if (toDate) q = q.lte('created_at', toDate) as typeof q;

    const { data, error } = await q.order('created_at', { ascending: false }).limit(PER_SOURCE_CAP);
    if (error) return this.warnEmpty('club_review_requests', error.message);

    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
      const club = firstOf(r['clubs'] as { name: string } | null);
      return {
        id: `club_review:${r['id'] as string}`,
        category: 'club_review',
        severity: r['status'] === 'pending' ? 'warning' : 'info',
        occurredAt: r['created_at'] as string,
        title: club?.name ?? null,
        detail: (r['review_notes'] as string | null) ?? null,
        actorUserId: (r['requester_user_id'] as string | null) ?? null,
        href: null,
      };
    });
  }

  private async fetchAiUsage(
    fromDate: string | undefined,
    toDate: string | undefined,
  ): Promise<RawEntry[]> {
    let q = this.supabase.service
      .from('ai_usage_log')
      .select('id, feature, model, provider, cost_eur, called_at');
    if (fromDate) q = q.gte('called_at', fromDate) as typeof q;
    if (toDate) q = q.lte('called_at', toDate) as typeof q;

    const { data, error } = await q.order('called_at', { ascending: false }).limit(PER_SOURCE_CAP);
    if (error) return this.warnEmpty('ai_usage_log', error.message);

    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
      const parts = [
        r['model'] as string | null,
        r['provider'] as string | null,
        r['cost_eur'] != null ? `€${r['cost_eur'] as number}` : null,
      ].filter(Boolean);
      return {
        id: `ai_usage:${r['id'] as string}`,
        category: 'ai_usage',
        severity: 'info',
        occurredAt: r['called_at'] as string,
        title: (r['feature'] as string | null) ?? null,
        detail: parts.length ? parts.join(' · ') : null,
        actorUserId: null,
        href: null,
      };
    });
  }

  private async fetchAiDrafts(
    fromDate: string | undefined,
    toDate: string | undefined,
  ): Promise<RawEntry[]> {
    let q = this.supabase.service
      .from('organizer_ai_assistant_drafts')
      .select(
        'id, draft_type, status, error, actor_user_id, rejected_by_user_id, created_at, updated_at',
      )
      .in('status', ['failed', 'rejected']);
    if (fromDate) q = q.gte('created_at', fromDate) as typeof q;
    if (toDate) q = q.lte('created_at', toDate) as typeof q;

    const { data, error } = await q.order('created_at', { ascending: false }).limit(PER_SOURCE_CAP);
    if (error) return this.warnEmpty('organizer_ai_assistant_drafts', error.message);

    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
      const rejected = r['status'] === 'rejected';
      return {
        id: `ai_draft:${r['id'] as string}`,
        category: 'ai_draft',
        severity: rejected ? 'warning' : 'error',
        occurredAt: (r['updated_at'] as string | null) ?? (r['created_at'] as string),
        title: (r['draft_type'] as string | null) ?? null,
        detail: (r['error'] as string | null) ?? null,
        actorUserId: rejected
          ? ((r['rejected_by_user_id'] as string | null) ?? (r['actor_user_id'] as string | null))
          : ((r['actor_user_id'] as string | null) ?? null),
        href: null,
      };
    });
  }

  private async fetchDeletions(
    fromDate: string | undefined,
    toDate: string | undefined,
  ): Promise<RawEntry[]> {
    let q = this.supabase.service
      .from('deletion_requests')
      .select(
        'id, target_type, status, reason, rejection_reason, requester_user_id, reviewed_by_user_id, created_at, updated_at',
      );
    if (fromDate) q = q.gte('created_at', fromDate) as typeof q;
    if (toDate) q = q.lte('created_at', toDate) as typeof q;

    const { data, error } = await q.order('created_at', { ascending: false }).limit(PER_SOURCE_CAP);
    if (error) return this.warnEmpty('deletion_requests', error.message);

    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
      const pending = r['status'] === 'pending';
      const rejected = r['status'] === 'rejected';
      return {
        id: `deletion:${r['id'] as string}`,
        category: 'deletion',
        severity: pending ? 'warning' : 'info',
        occurredAt: (r['updated_at'] as string | null) ?? (r['created_at'] as string),
        title: (r['target_type'] as string | null) ?? null,
        detail: rejected
          ? ((r['rejection_reason'] as string | null) ?? (r['reason'] as string | null) ?? null)
          : ((r['reason'] as string | null) ?? null),
        actorUserId: pending
          ? ((r['requester_user_id'] as string | null) ?? null)
          : ((r['reviewed_by_user_id'] as string | null) ??
            (r['requester_user_id'] as string | null) ??
            null),
        href: null,
      };
    });
  }

  private async fetchMerges(
    fromDate: string | undefined,
    toDate: string | undefined,
  ): Promise<RawEntry[]> {
    // A revert implies a prior merge, so merged_at is set on every matched row;
    // occurredAt uses the revert time when present. Filter/order on merged_at.
    let q = this.supabase.service
      .from('global_persons')
      .select('id, display_name, given_name, family_name, merged_at, merge_reverted_at')
      .or('merged_at.not.is.null,merge_reverted_at.not.is.null');
    if (fromDate) q = q.gte('merged_at', fromDate) as typeof q;
    if (toDate) q = q.lte('merged_at', toDate) as typeof q;

    const { data, error } = await q.order('merged_at', { ascending: false }).limit(PER_SOURCE_CAP);
    if (error) return this.warnEmpty('global_persons', error.message);

    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
      const name =
        (r['display_name'] as string | null) ||
        `${(r['given_name'] as string | null) ?? ''} ${(r['family_name'] as string | null) ?? ''}`.trim();
      return {
        id: `merge:${r['id'] as string}`,
        category: 'merge',
        severity: 'info',
        occurredAt: (r['merge_reverted_at'] as string | null) ?? (r['merged_at'] as string),
        title: name || null,
        detail: null,
        actorUserId: null,
        href: null,
      };
    });
  }

  private async fetchClubArchives(
    fromDate: string | undefined,
    toDate: string | undefined,
  ): Promise<RawEntry[]> {
    let q = this.supabase.service
      .from('clubs')
      .select('id, name, archived_at')
      .not('archived_at', 'is', null);
    if (fromDate) q = q.gte('archived_at', fromDate) as typeof q;
    if (toDate) q = q.lte('archived_at', toDate) as typeof q;

    const { data, error } = await q
      .order('archived_at', { ascending: false })
      .limit(PER_SOURCE_CAP);
    if (error) return this.warnEmpty('clubs', error.message);

    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: `club_archive:${r['id'] as string}`,
      category: 'club_archive',
      severity: 'info',
      occurredAt: r['archived_at'] as string,
      title: (r['name'] as string | null) ?? null,
      detail: null,
      actorUserId: null,
      href: null,
    }));
  }

  private warnEmpty(table: string, message: string): RawEntry[] {
    this.logger.warn(`platform-log: ${table} query failed — ${message}; contributing 0 rows.`);
    return [];
  }
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
