import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import type { ListAuditLogQueryDto } from './dto/admin-audit-log.dto';

const AUDIT_LOG_COLUMNS =
  'id, actor_user_id, action, entity_type, entity_id, payload_json, created_at';
const EXPORT_COLUMNS = 'created_at, actor_user_id, action, entity_type, entity_id, payload_json';
const DEFAULT_PAGE = 1;
const DEFAULT_PER_PAGE = 50;
const MAX_PER_PAGE = 100;
const EXPORT_LIMIT = 5000;

export interface AuditLogRow {
  id: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  payload_json: unknown;
  created_at: string;
  /**
   * Human-readable label resolved per `entity_type` so the operator
   * never has to read a raw UUID. Null when the underlying record
   * has been hard-deleted or the entity_type isn't yet in the
   * resolver switch; the FE keeps the UUID visible as a fallback.
   */
  entityLabel: string | null;
}

export interface AuditLogListResponse {
  items: AuditLogRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

interface QueryLike {
  eq(column: string, value: string): QueryLike;
  gte(column: string, value: string): QueryLike;
  lte(column: string, value: string): QueryLike;
}

interface ListQueryLike extends QueryLike {
  order(
    column: string,
    options: { ascending: boolean },
  ): {
    range(
      from: number,
      to: number,
    ): Promise<{
      data: unknown;
      error: { message?: string } | null;
      count?: number | null;
    }>;
  };
}

interface ExportQueryLike extends QueryLike {
  order(
    column: string,
    options: { ascending: boolean },
  ): {
    limit(limit: number): Promise<{
      data: unknown;
      error: { message?: string } | null;
    }>;
  };
}

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

function applyFilters<T extends QueryLike>(query: T, filters: ListAuditLogQueryDto): T {
  let next: QueryLike = query;
  if (filters.actor) next = next.eq('actor_user_id', filters.actor);
  if (filters.action) next = next.eq('action', filters.action);
  if (filters.entityType) next = next.eq('entity_type', filters.entityType);
  if (filters.from) next = next.gte('created_at', filters.from);
  if (filters.to) next = next.lte('created_at', filters.to);
  return next as T;
}

function csvEscape(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ''
      : typeof value === 'string'
        ? value
        : JSON.stringify(value);
  const escaped = text.replace(/"/g, '""');
  return /[",\r\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

function toCsv(rows: Array<Omit<AuditLogRow, 'id'>>): string {
  const header = 'created_at,actor_user_id,action,entity_type,entity_id,payload_json';
  const body = rows.map((row) =>
    [
      row.created_at,
      row.actor_user_id,
      row.action,
      row.entity_type,
      row.entity_id,
      row.payload_json,
    ]
      .map(csvEscape)
      .join(','),
  );
  return [header, ...body].join('\n');
}

@Injectable()
export class AdminAuditLogService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(query: ListAuditLogQueryDto): Promise<AuditLogListResponse> {
    assertDate(query.from, 'from');
    assertDate(query.to, 'to');

    const page = positiveInt(query.page, DEFAULT_PAGE);
    const perPage = Math.min(positiveInt(query.perPage, DEFAULT_PER_PAGE), MAX_PER_PAGE);
    const from = (page - 1) * perPage;
    const to = from + perPage - 1;

    const baseQuery = this.supabase.service
      .from('audit_log')
      .select(AUDIT_LOG_COLUMNS, { count: 'exact' }) as unknown as ListQueryLike;
    const filtered = applyFilters(baseQuery, query);
    const { data, error, count } = await filtered
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw new BadRequestException(error.message);
    const rawRows = (data as Array<Omit<AuditLogRow, 'entityLabel'>> | null) ?? [];
    const labels = await this.resolveEntityLabels(rawRows);
    const items: AuditLogRow[] = rawRows.map((row) => ({
      ...row,
      entityLabel: row.entity_id ? (labels.get(row.entity_id) ?? null) : null,
    }));
    const total = count ?? 0;
    return {
      items,
      total,
      page,
      perPage,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
    };
  }

  /**
   * Group the page's rows by entity_type, batch-fetch labels per
   * type, and return a single id → label Map covering every entity
   * encountered. Hard-deleted rows and types not in the switch
   * silently fall through (the FE renders the raw UUID).
   */
  private async resolveEntityLabels(
    rows: Array<{ entity_type: string | null; entity_id: string | null }>,
  ): Promise<Map<string, string>> {
    const byType = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!r.entity_type || !r.entity_id) continue;
      const set = byType.get(r.entity_type) ?? new Set<string>();
      set.add(r.entity_id);
      byType.set(r.entity_type, set);
    }
    const out = new Map<string, string>();
    for (const [type, ids] of byType) {
      const labels = await this.fetchLabelsForType(type, Array.from(ids));
      for (const [id, label] of labels) out.set(id, label);
    }
    return out;
  }

  private async fetchLabelsForType(type: string, ids: string[]): Promise<Map<string, string>> {
    switch (type) {
      case 'event': {
        const { data, error } = await this.supabase.service
          .from('events')
          .select('id, name')
          .in('id', ids);
        if (error) throw new BadRequestException(error.message);
        return new Map(
          ((data ?? []) as Array<{ id: string; name: string }>).map((r) => [r.id, r.name]),
        );
      }
      case 'phase': {
        const { data, error } = await this.supabase.service
          .from('phases')
          .select('id, type, tournaments(name)')
          .in('id', ids);
        if (error) throw new BadRequestException(error.message);
        return new Map(
          (
            (data ?? []) as Array<{
              id: string;
              type: string;
              tournaments: { name: string } | { name: string }[] | null;
            }>
          ).map((r) => {
            const t = Array.isArray(r.tournaments) ? r.tournaments[0] : r.tournaments;
            return [r.id, `${t?.name ?? ''} · ${r.type}`];
          }),
        );
      }
      case 'fighter': {
        const { data, error } = await this.supabase.service
          .from('global_persons')
          .select('id, display_name, given_name, family_name')
          .in('id', ids);
        if (error) throw new BadRequestException(error.message);
        return new Map(
          (
            (data ?? []) as Array<{
              id: string;
              display_name: string | null;
              given_name: string | null;
              family_name: string | null;
            }>
          ).map((r) => [
            r.id,
            r.display_name || `${r.given_name ?? ''} ${r.family_name ?? ''}`.trim(),
          ]),
        );
      }
      case 'user': {
        const { data, error } = await this.supabase.service
          .from('users')
          .select('id, email')
          .in('id', ids);
        if (error) throw new BadRequestException(error.message);
        return new Map(
          ((data ?? []) as Array<{ id: string; email: string }>).map((r) => [r.id, r.email]),
        );
      }
      case 'custom_ruleset': {
        const { data, error } = await this.supabase.service
          .from('custom_rulesets')
          .select('id, display_name')
          .in('id', ids);
        if (error) throw new BadRequestException(error.message);
        return new Map(
          ((data ?? []) as Array<{ id: string; display_name: string }>).map((r) => [
            r.id,
            r.display_name,
          ]),
        );
      }
      case 'league_membership_request': {
        const { data, error } = await this.supabase.service
          .from('league_membership_requests')
          .select('id, leagues(name), clubs(name)')
          .in('id', ids);
        if (error) throw new BadRequestException(error.message);
        return new Map(
          (
            (data ?? []) as Array<{
              id: string;
              leagues: { name: string } | { name: string }[] | null;
              clubs: { name: string } | { name: string }[] | null;
            }>
          ).map((r) => {
            const league = Array.isArray(r.leagues) ? r.leagues[0] : r.leagues;
            const club = Array.isArray(r.clubs) ? r.clubs[0] : r.clubs;
            return [r.id, `${club?.name ?? ''} → ${league?.name ?? ''}`];
          }),
        );
      }
      case 'league_scoring_system': {
        const { data, error } = await this.supabase.service
          .from('league_scoring_systems')
          .select('id, name')
          .in('id', ids);
        if (error) throw new BadRequestException(error.message);
        return new Map(
          ((data ?? []) as Array<{ id: string; name: string }>).map((r) => [r.id, r.name]),
        );
      }
      case 'organizer_ai_assistant_draft': {
        const { data, error } = await this.supabase.service
          .from('organizer_ai_assistant_drafts')
          .select('id, title')
          .in('id', ids);
        if (error) throw new BadRequestException(error.message);
        return new Map(
          ((data ?? []) as Array<{ id: string; title: string }>).map((r) => [r.id, r.title]),
        );
      }
      default:
        return new Map();
    }
  }

  async exportCsv(query: ListAuditLogQueryDto): Promise<string> {
    assertDate(query.from, 'from');
    assertDate(query.to, 'to');

    const baseQuery = this.supabase.service
      .from('audit_log')
      .select(EXPORT_COLUMNS) as unknown as ExportQueryLike;
    const filtered = applyFilters(baseQuery, query);
    const { data, error } = await filtered
      .order('created_at', { ascending: false })
      .limit(EXPORT_LIMIT);

    if (error) throw new BadRequestException(error.message);
    return toCsv((data as Array<Omit<AuditLogRow, 'id'>> | null) ?? []);
  }
}
