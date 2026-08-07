/**
 * entity-label.service.ts — batch id → human label resolution.
 *
 * Takes every (kind, id) pair a page needs, fires ONE query per kind with all
 * kinds in parallel, and returns a flat lookup. Never N+1, and — importantly —
 * never throws.
 *
 * WHY THE try/catch MATTERS: the switch this replaced threw a BadRequestException
 * on any PostgREST error, so a single bad lookup 400'd the whole list. Two of
 * those were live: `user` queried a `public.users` table that has not existed
 * since 0023, and `organizer_ai_assistant_draft` selected a `title` column the
 * table never had. Label resolution is decoration; a missing label must cost a
 * raw id and a log line, never the response.
 */
import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import type { ResolvedUser } from '../user-directory/user-directory.service';
import { UserDirectoryService } from '../user-directory/user-directory.service';
import { type EntityKind, LABEL_SPECS, labelKey } from './entity-label-specs';

/** Total payload references collected per request. */
export const MAX_PAYLOAD_REFS = 400;
/**
 * PostgREST serialises `.in()` into the query STRING, so this is a URL-length
 * budget, not a database one: 150 UUIDs ≈ 5.6 KB, comfortably under the usual
 * 8 KB header buffer.
 */
export const MAX_IDS_PER_KIND = 150;
/** UserDirectory's auth fallback is sequential per id — keep the tail bounded. */
export const MAX_USER_IDS = 50;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EntityLabelResult {
  /** `kind:id` → label. Absent means unresolved: hard-deleted, unknown kind, or a failed lookup. */
  labels: Map<string, string>;
  /** Exposed so callers that need name AND email don't resolve users twice. */
  users: Map<string, ResolvedUser>;
}

/** Merge ids into a kind-keyed request map, skipping anything that isn't a UUID. */
export function addRefs(
  refs: Map<EntityKind, Set<string>>,
  kind: EntityKind,
  ids: readonly (string | null | undefined)[],
): void {
  for (const id of ids) {
    if (!id || !UUID_RE.test(id)) continue;
    const set = refs.get(kind) ?? new Set<string>();
    set.add(id);
    refs.set(kind, set);
  }
}

@Injectable()
export class EntityLabelService {
  private readonly logger = new Logger(EntityLabelService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly userDirectory: UserDirectoryService,
  ) {}

  async resolve(refs: Map<EntityKind, Set<string>>): Promise<EntityLabelResult> {
    const labels = new Map<string, string>();

    const userIds = Array.from(refs.get('user') ?? []).slice(0, MAX_USER_IDS);
    const entityKinds = Array.from(refs.entries()).filter(([kind]) => kind !== 'user');

    const [userResult, ...entityResults] = await Promise.all([
      this.resolveUsers(userIds),
      ...entityKinds.map(([kind, ids]) =>
        this.resolveKind(kind, Array.from(ids).slice(0, MAX_IDS_PER_KIND)),
      ),
    ]);

    const users = userResult;
    for (const [id, user] of users) {
      const label = user.name ?? user.email;
      if (label) labels.set(labelKey('user', id), label);
    }
    for (const entries of entityResults) {
      for (const [key, label] of entries) labels.set(key, label);
    }
    return { labels, users };
  }

  private async resolveUsers(ids: string[]): Promise<Map<string, ResolvedUser>> {
    if (ids.length === 0) return new Map();
    try {
      return await this.userDirectory.resolveUsers(ids);
    } catch (error) {
      this.logger.warn(`User label resolution failed: ${String(error)}`);
      return new Map();
    }
  }

  private async resolveKind(kind: EntityKind, ids: string[]): Promise<Array<[string, string]>> {
    if (ids.length === 0) return [];
    const spec = LABEL_SPECS[kind as Exclude<EntityKind, 'user'>];
    if (!spec) return [];
    try {
      const { data, error } = await this.supabase.service
        .from(spec.table)
        .select(spec.columns)
        .in('id', ids);
      if (error) throw new Error(error.message);
      const entries: Array<[string, string]> = [];
      // `spec.columns` is a runtime string, so supabase-js can't infer the row
      // shape and falls back to GenericStringError[]. Go through `unknown`.
      for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
        const id = row['id'];
        if (typeof id !== 'string') continue;
        const label = spec.label(row);
        if (label) entries.push([labelKey(kind, id), label]);
      }
      return entries;
    } catch (error) {
      this.logger.warn(`Label resolution failed for kind "${kind}": ${String(error)}`);
      return [];
    }
  }
}
