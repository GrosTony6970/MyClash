/**
 * apps/api/src/common/auth/platform-role.ts
 *
 * The ONE owner of "what platform role does this user hold".
 *
 * Before this module, fourteen call sites across guards, interceptors and
 * services each hand-rolled the same PostgREST query
 * (`platform_roles … eq('role','super_admin') … maybeSingle()`). That was
 * survivable while `platform_roles.role` had exactly one possible value; with
 * three tiers (migration 0170) it is not. A predicate that answers "is this a
 * super admin" cannot be widened to "is this at least an admin" fourteen times
 * without one of them being missed, and a missed one fails OPEN or fails
 * INVISIBLE depending on which side of a boolean it sits.
 *
 * ## Deliberately a plain function, not a Nest provider
 *
 * `ClubsModule`, `PrivacyModule` and `OrganizationsModule` use the admin guard
 * without providing it: Nest registers a `@UseGuards(Class)` enhancer as an
 * injectable of the *host* module and resolves its constructor from that
 * module's injector, which works only because `SupabaseService` and
 * `ConfigService` are global. A resolver that were an injectable living in
 * `AdminModule` would fail to resolve in those modules at real boot — the
 * failure mode described in ENGINEERING_LESSONS as UndefinedModuleException.
 * Keeping this a free function, in the style of `insertAuditLog` and
 * `resolveRequestUserId`, sidesteps the whole class of problem.
 *
 * ## Fails closed, never throws
 *
 * A missing table (early bootstrap), a PostgREST error, or an unrecognised
 * `role` string all resolve to `null` — "holds no platform role". Every
 * previous call site wrapped its query in a bare `catch {}` that returned
 * false; that behaviour is preserved here once instead of fourteen times.
 */
import { ForbiddenException } from '@nestjs/common';
import { parsePlatformRole, atLeastPlatformRole, type PlatformRole } from '@myclash/types';
import type { SupabaseService } from '../../modules/supabase/supabase.service';
import { ANONYMOUS_USER_ID } from './request-user';

/**
 * Sentinels that are NOT user ids and must never resolve to a tier.
 *
 * `'unknown'` is the historical fallback of the copy-pasted `getActorId()` in
 * the admin controllers, and `'anonymous'` is what `resolveRequestUserId`
 * returns for an unauthenticated caller. Both are plain strings that would
 * otherwise be handed to `.eq('user_id', …)` — harmless today because no row
 * can match them, but only by accident. Rejecting them here makes it deliberate.
 */
const NON_USER_IDS: ReadonlySet<string> = new Set(['', ANONYMOUS_USER_ID, 'unknown']);

/**
 * The platform tier `userId` holds, or `null` for none.
 *
 * Note there is no `.eq('role', …)` filter: the row is fetched and its role
 * parsed, because the question this answers is "which tier", not "is it this
 * tier". Callers that want the old boolean use {@link hasPlatformTier}.
 */
export async function resolvePlatformRole(
  supabase: SupabaseService,
  userId: string | null | undefined,
): Promise<PlatformRole | null> {
  if (!userId || NON_USER_IDS.has(userId)) return null;

  try {
    const { data } = await supabase.service
      .from('platform_roles')
      .select('role')
      .eq('user_id', userId)
      .maybeSingle();
    if (!data) return null;
    return parsePlatformRole((data as { role?: unknown }).role);
  } catch {
    // Table absent during early bootstrap — treated as "no platform role",
    // matching what every call site did individually before.
    return null;
  }
}

/** Whether `userId` holds at least `min`. */
export async function hasPlatformTier(
  supabase: SupabaseService,
  userId: string | null | undefined,
  min: PlatformRole,
): Promise<boolean> {
  return atLeastPlatformRole(await resolvePlatformRole(supabase, userId), min);
}

/** Whether `userId` holds any platform role at all. */
export async function isPlatformStaff(
  supabase: SupabaseService,
  userId: string | null | undefined,
): Promise<boolean> {
  return (await resolvePlatformRole(supabase, userId)) !== null;
}

/** {@link hasPlatformTier} as an assertion. */
export async function assertPlatformTier(
  supabase: SupabaseService,
  userId: string | null | undefined,
  min: PlatformRole,
  message = 'Platform access required',
): Promise<void> {
  if (!(await hasPlatformTier(supabase, userId, min))) {
    throw new ForbiddenException(message);
  }
}
