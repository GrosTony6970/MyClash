/**
 * The public-read gate for an Event's contents: a DRAFT Event is org-only, and
 * answers anyone outside its organisation as an unknown one. Split out of
 * `event-authz.ts`, which keeps the write-side role checks.
 */
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { asEventKind, isPubliclyVisible } from '@myclash/types';
import type { EventAuthzDeps } from './event-authz';
import { ANONYMOUS_USER_ID } from './request-user';

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

/**
 * Is this Event on the public pages: not a draft, and not a TEST Event
 * (`event_kind`, rulings 97, 101)? The one owner, for a typed row and for a
 * PostgREST embed alike. A row read without `event_kind` counts as a standard
 * Event (`asEventKind` is fail-visible), so every reader must select it.
 */
export function isPublicEvent(
  event: { status?: unknown; event_kind?: unknown } | null | undefined,
): boolean {
  return (
    !!event &&
    !HIDDEN_EVENT_STATUSES.has(String(event.status ?? '')) &&
    isPubliclyVisible(asEventKind(event.event_kind))
  );
}

export interface EventVisibilityRow {
  status: string;
  organization_id: string;
  event_kind: string | null;
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
  throw eventNotFound(ref);
}

/** The 404 of `hidden()`: an unknown Event and a hidden one alike, in the same words. */
export function eventNotFound(ref: string): NotFoundException {
  return new NotFoundException(`Event "${ref}" not found`);
}

/**
 * Gate a row the caller had to read anyway, so the check costs no extra
 * round-trip there.
 *
 * `resolveUserId` is a THUNK on purpose. `resolveRequestUserId` does a GoTrue
 * round-trip whenever a token is present, and these are high-traffic reads —
 * the organiser grid re-reads the schedule after every mutation. A public
 * event returns at step 2 and never resolves an identity at all.
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
  if (isPublicEvent(row)) return;

  const userId = await resolveUserId();
  if (userId === ANONYMOUS_USER_ID) hidden(ref);

  try {
    // `read_only` is the floor of the role hierarchy, i.e. ANY member — the
    // same bar `is_org_member` sets in the RLS policy this mirrors.
    await deps.orgs.assertOrgRole(row.organization_id, userId, 'read_only');
  } catch (error) {
    // Only a refusal hides the Event; a failed read stays a 5xx.
    if (error instanceof ForbiddenException) hidden(ref);
    throw error;
  }
}

/**
 * The public-read gate for something reached through a phase.
 *
 * A phase carries no event id, so the visibility row is fetched through the same
 * `phases → tournaments` hop `orgIdForPhase` makes. An unknown phase RETURNS
 * rather than throwing, matching `assertCanReadEventRow`: the callers here
 * answer `[]` for an id that does not exist and inventing a 404 would be a
 * second, unrelated behaviour change.
 */
export async function assertCanReadPhase(
  deps: EventAuthzDeps,
  phaseId: string,
  resolveUserId: () => Promise<string>,
): Promise<void> {
  const { data, error } = await deps.supabase.service
    .from('phases')
    .select('tournaments!inner(events!inner(status, organization_id, event_kind))')
    .eq('id', phaseId)
    .maybeSingle();
  if (error) throw new BadRequestException(error.message);
  const event = (data as { tournaments?: { events?: EventVisibilityRow } } | null)?.tournaments
    ?.events;
  await assertCanReadEventRow(deps, phaseId, event ?? null, resolveUserId);
}

/** Fetch the visibility row, then gate on it. */
export async function assertCanReadEvent(
  deps: EventAuthzDeps,
  eventId: string,
  resolveUserId: () => Promise<string>,
): Promise<void> {
  const { data, error } = await deps.supabase.service
    .from('events')
    .select('status, organization_id, event_kind')
    .eq('id', eventId)
    .maybeSingle();
  if (error) throw new BadRequestException(error.message);
  await assertCanReadEventRow(deps, eventId, data as EventVisibilityRow | null, resolveUserId);
}
