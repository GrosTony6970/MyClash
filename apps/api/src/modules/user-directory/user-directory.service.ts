import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export interface ResolvedUser {
  name: string | null;
  email: string | null;
}

/**
 * user-directory.service.ts — Canonical user_id → { name, email } resolver.
 *
 * Three tiers, in order: global_persons (canonical display name), event-scoped
 * persons (email), then auth.users metadata (display_name / email) for accounts
 * that exist only in auth — super-admins and automated/E2E users that never
 * claimed a person record.
 *
 * Crucially, this NEVER returns the raw UUID as a name. Unresolved names come
 * back as `null` so the UI can render a localised "Unknown user" label
 * (server-side `t` is EN-only). This is the single source of truth for the
 * admin surfaces that show "who requested / reviewed / acted" — see
 * review-queue, frozen-results, audit-log and org-detail.
 */
@Injectable()
export class UserDirectoryService {
  constructor(private readonly supabase: SupabaseService) {}

  async resolveUsers(userIds: string[]): Promise<Map<string, ResolvedUser>> {
    const map = new Map<string, ResolvedUser>();
    const ids = Array.from(new Set(userIds.filter(Boolean)));
    if (ids.length === 0) return map;

    const [gpResult, personsResult] = await Promise.all([
      this.supabase.service
        .from('global_persons')
        .select('claimed_by_user_id, given_name, family_name')
        .in('claimed_by_user_id', ids),
      this.supabase.service
        .from('persons')
        .select('claimed_by_user_id, email')
        .in('claimed_by_user_id', ids),
    ]);

    const nameByUser = new Map<string, string>();
    for (const row of (gpResult.data ?? []) as Array<Record<string, unknown>>) {
      const uid = row['claimed_by_user_id'] as string | null;
      if (!uid || nameByUser.has(uid)) continue;
      const name =
        `${(row['given_name'] as string) ?? ''} ${(row['family_name'] as string) ?? ''}`.trim();
      if (name) nameByUser.set(uid, name);
    }

    const emailByUser = new Map<string, string>();
    for (const row of (personsResult.data ?? []) as Array<Record<string, unknown>>) {
      const uid = row['claimed_by_user_id'] as string | null;
      const email = row['email'] as string | null;
      if (uid && email && !emailByUser.has(uid)) emailByUser.set(uid, email);
    }

    // Tier 3 — auth.users for ids still missing a name and/or an email
    // (super-admins, automated/E2E accounts with no person record).
    for (const uid of ids) {
      if (nameByUser.has(uid) && emailByUser.has(uid)) continue;
      const auth = await this.resolveAuthUser(uid);
      if (!auth) continue;
      if (!nameByUser.has(uid) && auth.name) nameByUser.set(uid, auth.name);
      if (!emailByUser.has(uid) && auth.email) emailByUser.set(uid, auth.email);
    }

    for (const uid of new Set<string>([...nameByUser.keys(), ...emailByUser.keys()])) {
      map.set(uid, { name: nameByUser.get(uid) ?? null, email: emailByUser.get(uid) ?? null });
    }
    return map;
  }

  private async resolveAuthUser(userId: string): Promise<ResolvedUser | null> {
    try {
      const { data, error } = await this.supabase.service.auth.admin.getUserById(userId);
      if (error || !data?.user) return null;
      const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>;
      const displayName =
        typeof meta['display_name'] === 'string' ? meta['display_name'].trim() : '';
      return { name: displayName || null, email: data.user.email ?? null };
    } catch {
      return null;
    }
  }
}
