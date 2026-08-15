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
import { ANONYMOUS_USER_ID } from './request-user';

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

/**
 * Assert the caller is a MEMBER of the event's organisation, at any role.
 *
 * The bar for an event's staff data — referee assignments, availability, crew
 * names. Deliberately NOT `assertCanReadEvent`, which is the gate for an event's
 * PUBLIC contents and therefore only hides drafts: once an event is published,
 * that helper lets anyone through, which is correct for a schedule and wrong for
 * the people rostered to run it.
 *
 * `read_only` is the floor of the role hierarchy, so this means "any member",
 * matching the `is_org_member` bar the RLS policies use.
 */
export async function assertEventMember(
  deps: EventAuthzDeps,
  eventId: string,
  userId: string,
): Promise<string> {
  const orgId = await orgIdForEvent(deps.supabase, eventId);
  await deps.orgs.assertOrgRole(orgId, userId, 'read_only');
  return orgId;
}

// ── Reads ────────────────────────────────────────────────────────────────────

/**
 * The only event status whose contents are org-only.
 *
 * `matches_select` (0002_rls.sql:523-533) and `listEvents`
 * (events.service.ts:186) both exclude `archived` as well. This does NOT:
 * a past event's public page is the reason to keep the event around, and the
 * lock archiving applies is a WRITE lock — EventReadOnlyGuard — not a curtain.
 * The divergence is the decision, not an oversight.
 *
 * `status` defaults to 'draft' (events.service.ts:563), so an event is org-only
 * from creation until it is published, which is the whole point.
 */
const HIDDEN_EVENT_STATUSES = new Set(['draft']);

export interface EventVisibilityRow {
  status: string;
  organization_id: string;
}

/**
 * A non-public event is 404, never 403 — a 403 confirms it exists, and the
 * existence of an unannounced event is part of what is being hidden.
 *
 * `ref` is whatever the caller was addressed BY, not always the id: on
 * `getEventBySlug` it is the slug, so a hidden event and a slug that matches
 * nothing produce the same sentence. Echoing the id there would have handed
 * back the very thing the gate exists to withhold.
 */
function hidden(ref: string): never {
  throw new NotFoundException(`Event "${ref}" not found`);
}

/**
 * Gate a row the caller had to read anyway (`live-state` already selects from
 * `events`), so the check costs no extra round-trip there.
 *
 * `resolveUserId` is a THUNK on purpose. `resolveRequestUserId` does a GoTrue
 * round-trip whenever a token is present, and these are the highest-traffic
 * reads in the API — the organiser grid re-reads the schedule after every
 * mutation, and hall displays poll live-state continuously. A public event
 * returns at step 2 and never resolves an identity at all.
 *
 * A missing row returns rather than throwing: `/schedule` answers `[]` for an
 * unknown id today and its callers depend on that shape. Inventing a 404 here
 * would be a second, unrelated behaviour change.
 */
export async function assertCanReadEventRow(
  deps: EventAuthzDeps,
  ref: string,
  row: EventVisibilityRow | null,
  resolveUserId: () => Promise<string>,
): Promise<void> {
  if (!row) return;
  if (!HIDDEN_EVENT_STATUSES.has(row.status)) return;

  const userId = await resolveUserId();
  if (userId === ANONYMOUS_USER_ID) hidden(ref);

  try {
    // `read_only` is the floor of the role hierarchy, i.e. ANY member — the
    // same bar `is_org_member` sets in the RLS policy this mirrors.
    await deps.orgs.assertOrgRole(row.organization_id, userId, 'read_only');
  } catch {
    hidden(ref);
  }
}

/** Fetch the visibility row, then gate on it. */
export async function assertCanReadEvent(
  deps: EventAuthzDeps,
  eventId: string,
  resolveUserId: () => Promise<string>,
): Promise<void> {
  const { data, error } = await deps.supabase.service
    .from('events')
    .select('status, organization_id')
    .eq('id', eventId)
    .maybeSingle();
  if (error) throw new BadRequestException(error.message);
  await assertCanReadEventRow(deps, eventId, data as EventVisibilityRow | null, resolveUserId);
}
