/**
 * Org-role authorization for event-scoped writes, resolved from the row rather
 * than from the request.
 *
 * WHY THIS EXISTS: `AuthGuard` is authentication only — its own docblock says
 * so, and a 200 from it means "we know who you are", never "you may do this".
 * Authorization lives in the service layer behind `assertOrgRole`, and because
 * every schedule write goes through the service-role Supabase client (which is
 * BYPASSRLS), that assertion is the WHOLE boundary, not defence in depth.
 *
 * Three modules had already written this resolve-then-assert step privately —
 * `staff.assertCanManageEventStaff`, `leagues.assertCanManageEvent`,
 * `workshops.assertEventRole`. The schedule write surface had none of it at
 * all, so rather than add a fourth copy the shared one lives here.
 *
 * NO PLATFORM-ROLE BYPASS, deliberately. None of those three has one either: a
 * platform admin who is not a member of the org is refused by every other
 * event surface, and adding an escape hatch here alone would make the schedule
 * the single inconsistent one. `events.assertOwnerOrSuperAdmin` is not a
 * counter-example — that guards ruleset re-pinning, a `super_admin`-exact
 * data-integrity override, not ordinary event management. A platform admin who
 * must edit a customer's schedule gets added to the organisation, which is how
 * they already reach its workshops and leagues.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { OrganizationsService } from '../../modules/organizations/organizations.service';
import type { SupabaseService } from '../../modules/supabase/supabase.service';

export type OrgRole = Parameters<OrganizationsService['assertOrgRole']>[2];

/** The default bar for editing an event's schedule, matching staff + leagues. */
export const MANAGE_EVENT_ROLE: OrgRole = 'editor';

export interface EventAuthzDeps {
  supabase: SupabaseService;
  orgs: OrganizationsService;
}

async function orgIdForEvent(supabase: SupabaseService, eventId: string): Promise<string> {
  const { data, error } = await supabase.service
    .from('events')
    .select('organization_id')
    .eq('id', eventId)
    .maybeSingle();
  if (error) throw new BadRequestException(error.message);
  if (!data) throw new NotFoundException(`Event ${eventId} not found`);
  return String((data as { organization_id: string }).organization_id);
}

/**
 * A lice belongs to exactly one event (`lices.event_id` is required), so the
 * hop is single. Deleting one is destructive beyond the row itself:
 * `matches.lice_id` is ON DELETE SET NULL, so it silently unschedules every
 * match on that piste.
 */
async function orgIdForLice(supabase: SupabaseService, liceId: string): Promise<string> {
  const { data, error } = await supabase.service
    .from('lices')
    .select('event_id')
    .eq('id', liceId)
    .maybeSingle();
  if (error) throw new BadRequestException(error.message);
  if (!data) throw new NotFoundException(`Lice ${liceId} not found`);
  return orgIdForEvent(supabase, String((data as { event_id: string }).event_id));
}

/**
 * `pools` carry no event id — the chain is pool → phase → tournament → event,
 * the same shape `EventReadOnlyGuard` walks. A shortcut through
 * `matches.tournament_id` does not exist; that column is not in the schema.
 */
async function orgIdForPool(supabase: SupabaseService, poolId: string): Promise<string> {
  const { data, error } = await supabase.service
    .from('pools')
    .select('phases!inner(tournaments!inner(event_id))')
    .eq('id', poolId)
    .maybeSingle();
  if (error) throw new BadRequestException(error.message);
  const eventId = (data as { phases?: { tournaments?: { event_id?: string } } } | null)?.phases
    ?.tournaments?.event_id;
  if (!eventId) throw new NotFoundException(`Pool ${poolId} not found`);
  return orgIdForEvent(supabase, eventId);
}

/** Assert the caller may manage `eventId`, and return its organisation id. */
export async function assertCanManageEvent(
  deps: EventAuthzDeps,
  eventId: string,
  userId: string,
  minRole: OrgRole = MANAGE_EVENT_ROLE,
): Promise<string> {
  const orgId = await orgIdForEvent(deps.supabase, eventId);
  await deps.orgs.assertOrgRole(orgId, userId, minRole);
  return orgId;
}

/** Assert the caller may manage the event a lice belongs to. */
export async function assertCanManageLice(
  deps: EventAuthzDeps,
  liceId: string,
  userId: string,
  minRole: OrgRole = MANAGE_EVENT_ROLE,
): Promise<string> {
  const orgId = await orgIdForLice(deps.supabase, liceId);
  await deps.orgs.assertOrgRole(orgId, userId, minRole);
  return orgId;
}

/** Assert the caller may manage the event a pool belongs to. */
export async function assertCanManagePool(
  deps: EventAuthzDeps,
  poolId: string,
  userId: string,
  minRole: OrgRole = MANAGE_EVENT_ROLE,
): Promise<string> {
  const orgId = await orgIdForPool(deps.supabase, poolId);
  await deps.orgs.assertOrgRole(orgId, userId, minRole);
  return orgId;
}
