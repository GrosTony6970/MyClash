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
    const total = count ?? 0;
    return {
      items: (data as AuditLogRow[] | null) ?? [],
      total,
      page,
      perPage,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
    };
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
