/**
 * draft-gate.ts — what every draft tool asks before it saves, and how it answers (MCP slice 4b,
 * calls R, W, X). Marie asks Claude for 4 Pools; the tool saves ONE draft and answers its names
 * and a link. Nothing in the Event changes until she presses Apply in MyClash.
 *
 * The order: maintenance, before any read; the Event by slug, through the public Event gate; an
 * org admin or owner, the bar of the drafts and of Apply (call R); an Event that is over. Each
 * tool then refuses what Apply would refuse (call X) and calls `saveDraft`.
 *
 * The races it accepts: the gate and `createDraftFromAction` each ask the admin bar. An admin
 * removed between the two gets the generic failure, not the admin refusal. And a draft can go
 * stale between its save and Apply: the slug is taken, Pools are made, the weapon is retired
 * from the catalogue. Apply asks each again and marks the draft failed; the link then shows why.
 */
import type { ReadableDraftAction } from '@myclash/types';
import { ForbiddenException } from '@nestjs/common';
import { isOver } from '../../../common/live-status';
import type { McpCaller, McpToolDeps } from '../mcp-server';
import { appName } from './connector-app-name';
import type { McpRefusal } from './mcp-answer';
import { noEventRefusal, readableEventBySlug, type McpEvent } from './readable-event';
import { maintenanceRefusal } from './referee-write-gate';

/** The Event a draft is made at, and its organisation: its id for checks, its slug for the link. */
export interface DraftGate {
  event: McpEvent;
  orgId: string;
  orgSlug: string;
}

/** What a draft tool answers: the draft by name, where to open it, and its status. */
export interface DraftAnswer {
  draft: ReadableDraftAction[];
  link: string;
  status: string;
}

/** The Event's organisation: its id for the admin bar, its slug for the link. */
async function eventOrganisation(
  deps: McpToolDeps,
  eventId: string,
): Promise<{ id: string; slug: string }> {
  const { data, error } = await deps.supabase.service
    .from('events')
    .select('organization_id, organizations!inner(slug)')
    .eq('id', eventId)
    .maybeSingle();
  if (error) throw new Error(`event organisation read failed: ${error.message}`);
  const row = data as {
    organization_id: string;
    organizations: { slug: string } | { slug: string }[];
  } | null;
  // The typed client reads a to-one embed as an array.
  const org = Array.isArray(row?.organizations) ? row.organizations[0] : row?.organizations;
  if (!row || !org?.slug) throw new Error('event organisation read failed: no organisation');
  return { id: row.organization_id, slug: org.slug };
}

/** Maintenance, the Event, the admin bar and an Event that is over, in that order. */
export async function draftGate(
  eventSlug: string,
  caller: McpCaller,
  deps: McpToolDeps,
): Promise<DraftGate | McpRefusal> {
  const maintenance = await maintenanceRefusal(deps);
  if (maintenance) return maintenance;
  const event = await readableEventBySlug(eventSlug, caller, deps);
  if (!event) return noEventRefusal(eventSlug);
  const org = await eventOrganisation(deps, event.id);
  try {
    await deps.orgs.assertOrgRole(org.id, caller.userId, 'admin');
  } catch (refused) {
    if (!(refused instanceof ForbiddenException)) throw refused;
    return { refusal: `Only the organisation's admins can make drafts at ${event.name}.` };
  }
  if (isOver(event.status)) {
    return { refusal: `${event.name} is over: nothing there can change now.` };
  }
  return { event, orgId: org.id, orgSlug: org.slug };
}

/**
 * The one place an id leaves the MCP server (call W): the assistant page, opened on this draft.
 * The tools' text never names an id.
 */
export function draftLink(domain: string, gate: DraftGate, draftId: string): string {
  const path = `/org/${gate.orgSlug}/events/${gate.event.id}/ai-assistant`;
  return `https://admin.${domain}${path}?draft=${draftId}`;
}

/**
 * The save: ONE draft of `actions`, from Claude (`source: 'mcp'`), its audit row naming the app.
 * A draft the shape check marks `failed` answers its errors as a refusal, not a link.
 */
export async function saveDraft(
  gate: DraftGate,
  actions: Array<Record<string, unknown>>,
  caller: McpCaller,
  deps: McpToolDeps,
): Promise<DraftAnswer | McpRefusal> {
  // Before the save: a draft whose link cannot be built would be saved and never shown.
  if (!deps.domain) throw new Error('no DOMAIN: a draft link cannot be built');
  const clientName = await appName(deps, caller.clientId);
  const draft = await deps.assistant.createDraftFromAction(gate.event.id, caller.userId, actions, {
    source: 'mcp',
    auditExtra: { via: 'mcp', clientId: caller.clientId, clientName },
  });
  if (draft.status === 'failed') {
    const errors = (draft.validationState as { errors?: unknown }).errors;
    const words = Array.isArray(errors) ? errors.filter((e) => typeof e === 'string') : [];
    return { refusal: `MyClash cannot use this draft: ${words.join('; ')}.` };
  }
  return {
    draft: draft.readable,
    link: draftLink(deps.domain, gate, draft.id),
    status: draft.status,
  };
}
