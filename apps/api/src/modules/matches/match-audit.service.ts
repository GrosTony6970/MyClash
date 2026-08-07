/**
 * match-audit.service.ts — the audit trail for one match, for organisers.
 *
 * Distinct from the super-admin audit log in two ways that matter:
 *
 *  1. SCOPE. It only ever returns rows about this match — the exchange edits and
 *     the correction requests filed against it. It never exposes the platform-wide
 *     log.
 *  2. LABEL SCOPE. The shared EntityLabelService runs on the service role with no
 *     org filtering, which is right under PlatformRoleGuard and wrong here: the
 *     `exchange_edit_request.approve` payload embeds the whole request row,
 *     including `reviewed_by_user_id` — and the reviewer is by definition a
 *     platform super-admin. Resolving that naively would hand an org editor a
 *     super-admin's name and email. So this service resolves through an
 *     ALLOWLIST built from ids it already proved belong to this match, and
 *     drops emails entirely.
 */
import { Injectable } from '@nestjs/common';
import { type PayloadRef, collectPayloadRefs } from '../entity-label/audit-payload-refs';
import { type EntityKind, labelKey } from '../entity-label/entity-label-specs';
import {
  EntityLabelService,
  MAX_PAYLOAD_REFS,
  addRefs,
} from '../entity-label/entity-label.service';
import { SupabaseService } from '../supabase/supabase.service';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** The only kinds an organiser may resolve here. Anything else stays a raw id. */
const ALLOWED_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>([
  'match',
  'exchange',
  'event',
  'exchange_edit_request',
  'user',
]);

export interface MatchAuditEntry {
  id: string;
  actorUserId: string | null;
  /** Name only — never an email on this surface. Null when unresolved. */
  actorDisplayName: string | null;
  action: string;
  entityType: string;
  entityId: string;
  entityLabel: string | null;
  payloadJson: unknown;
  /** RFC 6901 JSON Pointer → label, same contract as the admin audit log. */
  payloadLabels: Record<string, { label: string; kind: string }>;
  createdAt: string;
}

interface RawRow {
  id: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  payload_json: unknown;
  created_at: string;
}

/** Ids this match legitimately owns, plus the users who acted on it. */
interface Allowlist {
  ids: Map<EntityKind, Set<string>>;
  userIds: Set<string>;
}

@Injectable()
export class MatchAuditService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly entityLabels: EntityLabelService,
  ) {}

  async listForMatch(matchId: string, limit?: number): Promise<MatchAuditEntry[]> {
    const capped = Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const allow = await this.buildAllowlist(matchId);

    const exchangeIds = Array.from(allow.ids.get('exchange') ?? []);
    const requestIds = Array.from(allow.ids.get('exchange_edit_request') ?? []);
    const rows = await this.fetchRows(exchangeIds, requestIds, capped);
    if (rows.length === 0) return [];

    // The actor of a row about this match is in scope by construction.
    for (const row of rows) {
      if (row.actor_user_id) allow.userIds.add(row.actor_user_id);
    }

    const budget = { remaining: MAX_PAYLOAD_REFS };
    const rowRefs = rows.map((row) => collectPayloadRefs(row.action, row.payload_json, budget));
    const { labels, users } = await this.entityLabels.resolve(
      this.scopedRefs(rowRefs, allow, rows),
    );

    return rows.map((row, index) => this.toEntry(row, rowRefs[index] ?? [], labels, users));
  }

  /**
   * Everything this match provably owns. Built BEFORE any label lookup so the
   * resolver can only ever be asked about in-scope ids.
   */
  private async buildAllowlist(matchId: string): Promise<Allowlist> {
    const ids = new Map<EntityKind, Set<string>>();
    const userIds = new Set<string>();

    const [exchangeResult, requestResult] = await Promise.all([
      this.supabase.service.from('exchanges').select('id').eq('match_id', matchId),
      this.supabase.service
        .from('exchange_edit_requests')
        .select('id, event_id, requested_by_user_id, reviewed_by_user_id')
        .eq('match_id', matchId),
    ]);

    // The caller already went through authorizeMatchOrganizer, which loads the
    // match and throws when it is missing — no need to prove it exists again.
    addRefs(ids, 'match', [matchId]);
    addRefs(
      ids,
      'exchange',
      ((exchangeResult.data ?? []) as Array<{ id: string }>).map((r) => r.id),
    );

    const requests = (requestResult.data ?? []) as Array<{
      id: string;
      event_id: string | null;
      requested_by_user_id: string | null;
      reviewed_by_user_id: string | null;
    }>;
    addRefs(
      ids,
      'exchange_edit_request',
      requests.map((r) => r.id),
    );
    addRefs(
      ids,
      'event',
      requests.map((r) => r.event_id),
    );
    for (const request of requests) {
      if (request.requested_by_user_id) userIds.add(request.requested_by_user_id);
      if (request.reviewed_by_user_id) userIds.add(request.reviewed_by_user_id);
    }
    return { ids, userIds };
  }

  private async fetchRows(
    exchangeIds: string[],
    requestIds: string[],
    limit: number,
  ): Promise<RawRow[]> {
    const filters: string[] = [];
    if (exchangeIds.length > 0) {
      filters.push(`and(entity_type.eq.exchange,entity_id.in.(${exchangeIds.join(',')}))`);
    }
    if (requestIds.length > 0) {
      filters.push(
        `and(entity_type.eq.exchange_edit_request,entity_id.in.(${requestIds.join(',')}))`,
      );
    }
    if (filters.length === 0) return [];

    const { data, error } = await this.supabase.service
      .from('audit_log')
      .select('id, actor_user_id, action, entity_type, entity_id, payload_json, created_at')
      .or(filters.join(','))
      .order('created_at', { ascending: false })
      .limit(limit);
    // An audit read is decoration on the match page — degrade, never 500 the page.
    if (error) return [];
    return (data ?? []) as unknown as RawRow[];
  }

  /** Intersect the collected refs with the allowlist. */
  private scopedRefs(
    rowRefs: readonly PayloadRef[][],
    allow: Allowlist,
    rows: readonly RawRow[],
  ): Map<EntityKind, Set<string>> {
    const refs = new Map<EntityKind, Set<string>>();
    for (const row of rows) {
      const kind: EntityKind =
        row.entity_type === 'exchange_edit_request' ? 'exchange_edit_request' : 'exchange';
      if (allow.ids.get(kind)?.has(row.entity_id)) addRefs(refs, kind, [row.entity_id]);
    }
    for (const list of rowRefs) {
      for (const ref of list) {
        if (!ALLOWED_KINDS.has(ref.kind)) continue;
        const permitted =
          ref.kind === 'user' ? allow.userIds.has(ref.id) : allow.ids.get(ref.kind)?.has(ref.id);
        if (permitted) addRefs(refs, ref.kind, [ref.id]);
      }
    }
    addRefs(refs, 'user', Array.from(allow.userIds));
    return refs;
  }

  private toEntry(
    row: RawRow,
    refs: readonly PayloadRef[],
    labels: ReadonlyMap<string, string>,
    users: ReadonlyMap<string, { name: string | null; email: string | null }>,
  ): MatchAuditEntry {
    const payloadLabels: Record<string, { label: string; kind: string }> = {};
    for (const ref of refs) {
      // EntityLabelService labels a user as `name ?? email`. That email fallback
      // is fine for super-admins; here it would leak a reviewer's address into an
      // organiser's payload view, so users resolve from `name` only.
      const label =
        ref.kind === 'user'
          ? (users.get(ref.id)?.name ?? null)
          : (labels.get(labelKey(ref.kind, ref.id)) ?? null);
      if (label) payloadLabels[ref.pointer] = { label, kind: ref.kind };
    }
    const kind: EntityKind =
      row.entity_type === 'exchange_edit_request' ? 'exchange_edit_request' : 'exchange';
    return {
      id: row.id,
      actorUserId: row.actor_user_id,
      // Name only: an organiser has a legitimate interest in WHO acted on their
      // match, not in that person's contact details.
      actorDisplayName: row.actor_user_id ? (users.get(row.actor_user_id)?.name ?? null) : null,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      entityLabel: labels.get(labelKey(kind, row.entity_id)) ?? null,
      payloadJson: row.payload_json,
      payloadLabels,
      createdAt: row.created_at,
    };
  }
}
