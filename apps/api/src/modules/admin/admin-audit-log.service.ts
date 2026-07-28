import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import {
  type PayloadRef,
  type RefBudget,
  collectPayloadRefs,
} from '../entity-label/audit-payload-refs';
import type { ListAuditLogQueryDto } from './dto/admin-audit-log.dto';
import { ENTITY_TYPE_TO_KIND, type EntityKind, labelKey } from '../entity-label/entity-label-specs';
import {
  EntityLabelService,
  MAX_PAYLOAD_REFS,
  addRefs,
} from '../entity-label/entity-label.service';

const AUDIT_LOG_COLUMNS =
  'id, actor_user_id, action, entity_type, entity_id, payload_json, created_at';
const EXPORT_COLUMNS = 'created_at, actor_user_id, action, entity_type, entity_id, payload_json';
const DEFAULT_PAGE = 1;
const DEFAULT_PER_PAGE = 50;
const MAX_PER_PAGE = 100;
const EXPORT_LIMIT = 5000;

export interface PayloadLabel {
  label: string;
  /** The entity kind the id points at, so the FE can style without re-deriving. */
  kind: string;
}

export interface AuditLogRow {
  id: string;
  actor_user_id: string | null;
  /** Resolved actor display name / email so the operator never reads a raw UUID. */
  actorName: string | null;
  actorEmail: string | null;
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
  /**
   * RFC 6901 JSON Pointer into `payload_json` → the label for the id at that
   * position, e.g. `{ "/moved/personIds/0": { label: "Alice Smith", kind: "person" } }`.
   *
   * `payload_json` itself is returned byte-identical: the audit log is a
   * forensic record, and swapping a name in for a UUID would destroy the join
   * key an operator needs to correlate rows. An absent pointer simply means the
   * FE renders the raw string it already has.
   */
  payloadLabels: Record<string, PayloadLabel>;
}

/** What `exportCsv` actually selects — narrower than a listed row. */
interface AuditLogExportRow {
  created_at: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  payload_json: unknown;
}

type RawAuditLogRow = Omit<
  AuditLogRow,
  'entityLabel' | 'actorName' | 'actorEmail' | 'payloadLabels'
>;

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

function toCsv(rows: AuditLogExportRow[]): string {
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

/**
 * Decorate a raw row with everything the operator actually reads: the actor's
 * name, the entity's label, and a pointer→label map for the ids inside the
 * payload. `payload_json` is passed through untouched.
 */
function toAuditLogRow(
  row: RawAuditLogRow,
  refs: readonly PayloadRef[],
  labels: ReadonlyMap<string, string>,
  users: ReadonlyMap<string, { name: string | null; email: string | null }>,
): AuditLogRow {
  const actor = row.actor_user_id ? users.get(row.actor_user_id) : null;
  const entityKind = ENTITY_TYPE_TO_KIND[row.entity_type];
  const payloadLabels: Record<string, PayloadLabel> = {};
  for (const ref of refs) {
    const label = labels.get(labelKey(ref.kind, ref.id));
    if (label) payloadLabels[ref.pointer] = { label, kind: ref.kind };
  }
  return {
    ...row,
    actorName: actor?.name ?? null,
    actorEmail: actor?.email ?? null,
    entityLabel:
      entityKind && row.entity_id
        ? (labels.get(labelKey(entityKind, row.entity_id)) ?? null)
        : null,
    payloadLabels,
  };
}

@Injectable()
export class AdminAuditLogService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly entityLabels: EntityLabelService,
  ) {}

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
    const rawRows = (data as RawAuditLogRow[] | null) ?? [];

    // One budget for the whole page: a single pathological payload can't starve
    // the rest of the rows out of their labels.
    const budget: RefBudget = { remaining: MAX_PAYLOAD_REFS };
    const rowRefs = rawRows.map((row) => collectPayloadRefs(row.action, row.payload_json, budget));
    const { labels, users } = await this.entityLabels.resolve(this.collectRefs(rawRows, rowRefs));

    const items = rawRows.map((row, index) =>
      toAuditLogRow(row, rowRefs[index] ?? [], labels, users),
    );
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
   * Every (kind, id) the page needs, in one map: actors, top-level entities and
   * payload references alike. Actors and payload user refs share the `user`
   * bucket, so a `user.update` row whose entity_id IS its actor costs one lookup.
   */
  private collectRefs(
    rows: readonly RawAuditLogRow[],
    rowRefs: readonly PayloadRef[][],
  ): Map<EntityKind, Set<string>> {
    const refs = new Map<EntityKind, Set<string>>();
    addRefs(
      refs,
      'user',
      rows.map((row) => row.actor_user_id),
    );
    for (const row of rows) {
      const kind = ENTITY_TYPE_TO_KIND[row.entity_type];
      if (kind) addRefs(refs, kind, [row.entity_id]);
    }
    for (const list of rowRefs) {
      for (const ref of list) addRefs(refs, ref.kind, [ref.id]);
    }
    return refs;
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
    return toCsv((data as AuditLogExportRow[] | null) ?? []);
  }
}
