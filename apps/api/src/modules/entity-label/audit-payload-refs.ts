/**
 * audit-payload-refs.ts — find the entity references buried inside `payload_json`.
 *
 * The audit log resolves its top-level `entity_id` to a human label, but audit
 * payloads carry plenty of their own UUIDs — `orgId`, `moved.personIds[]`, whole
 * row snapshots under `source` / `request`. Rendering those raw is the "no raw
 * ids in UI" violation this module exists to close: it walks a payload, decides
 * which strings are entity references and what they point at, and hands back
 * JSON Pointers the resolver can label and the frontend can look up.
 *
 * MAINTENANCE: when you add an `insertAuditLog(...)` call anywhere, add a rule
 * here for any id your payload carries — otherwise it renders as a raw UUID.
 * (Personal VALUES are handled separately, at write time, by
 * ../../common/audit-log#maskAuditPayload. This file is about id REFERENCES.)
 */
import type { EntityKind } from './entity-label-specs';

export interface RefRule {
  /** Path suffix, outermost→innermost. Array indices are elided before matching. */
  suffix: readonly string[];
  kind: EntityKind;
  /** When set, applies only to rows with this exact `action`. Highest precedence. */
  action?: string;
}

/**
 * Deliberately lenient — shape only, no RFC 4122 version/variant nibbles.
 * A false negative here costs nothing (the raw id renders, as it does today),
 * whereas a strict regex silently drops real references from seeded data.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A payload is a blob of unvalidated JSONB; these bound the walk. */
const MAX_DEPTH = 6;
const MAX_NODES = 2000;
/** Longest `suffix` in REF_RULES. Bumping a rule past this needs this bumped too. */
const MAX_SUFFIX = 2;

/**
 * Rules derived from a census of every audit_log writer in apps/api.
 *
 * Single-segment suffixes match at ANY depth, which is what makes row snapshots
 * work for free: `club_id` inside a `global_persons` snapshot resolves without
 * anyone enumerating that path. Two-segment suffixes disambiguate `id`, which
 * means four different entities depending on which snapshot it sits in.
 *
 * `sourceId` / `source_id` deliberately have NO global rule. They mean different
 * entities in different actions, and in an audit log a confidently wrong label is
 * worse than a missing one — it corrupts the record. Unmatched keys stay raw.
 */
export const REF_RULES: readonly RefRule[] = [
  // ── Users ───────────────────────────────────────────────────────────────────
  { suffix: ['owner_user_id'], kind: 'user' },
  { suffix: ['new_owner_user_id'], kind: 'user' },
  { suffix: ['requested_by_user_id'], kind: 'user' },
  { suffix: ['reviewed_by_user_id'], kind: 'user' },
  { suffix: ['claimed_by_user_id'], kind: 'user' },
  // ── Orgs / clubs / leagues ──────────────────────────────────────────────────
  { suffix: ['organization_id'], kind: 'organization' },
  { suffix: ['organizationId'], kind: 'organization' },
  { suffix: ['orgId'], kind: 'organization' },
  { suffix: ['club_id'], kind: 'club' },
  { suffix: ['leagueId'], kind: 'league' },
  // ── Competition structure ───────────────────────────────────────────────────
  { suffix: ['eventId'], kind: 'event' },
  { suffix: ['event_id'], kind: 'event' },
  { suffix: ['tournamentId'], kind: 'tournament' },
  { suffix: ['tournament_id'], kind: 'tournament' },
  { suffix: ['phase_id'], kind: 'phase' },
  { suffix: ['match_id'], kind: 'match' },
  { suffix: ['exchange_id'], kind: 'exchange' },
  // `fighters` was renamed to `global_persons` in 0023; the FK columns kept the
  // old name, so `fighter_id` points at a global_person, not an event-scoped person.
  { suffix: ['fighter_id'], kind: 'global_person' },
  { suffix: ['global_fighter_id'], kind: 'global_person' },
  { suffix: ['person_id'], kind: 'person' },
  // ── Rulesets ────────────────────────────────────────────────────────────────
  { suffix: ['forkId'], kind: 'custom_ruleset' },
  { suffix: ['versionId'], kind: 'custom_ruleset_version' },
  { suffix: ['restored_from_version_id'], kind: 'league_scoring_system_version' },
  // ── Misc singletons ─────────────────────────────────────────────────────────
  { suffix: ['reverted_audit_log_id'], kind: 'audit_log' },
  { suffix: ['broadcastId'], kind: 'event_broadcast_notification' },
  { suffix: ['conversationId'], kind: 'organizer_chat_conversation' },
  // Only review-queue writes `requestId` into a payload (deletion_requests);
  // frozen-results keeps its own `requestId` in the HTTP response, not the audit row.
  { suffix: ['requestId'], kind: 'deletion_request' },
  // ── Arrays (merge.service moved.*) ──────────────────────────────────────────
  { suffix: ['personIds'], kind: 'person' },
  { suffix: ['workshopInstructorIds'], kind: 'workshop_instructor' },
  { suffix: ['registrationIds'], kind: 'registration' },
  // ── `id` inside a row snapshot — meaningless as a bare leaf name ────────────
  { suffix: ['source', 'id'], kind: 'global_person' },
  { suffix: ['target', 'id'], kind: 'global_person' },
  { suffix: ['exchange', 'id'], kind: 'exchange' },
  { suffix: ['request', 'id'], kind: 'exchange_edit_request' },
  // ── Action-scoped: the genuinely ambiguous names ────────────────────────────
  { action: 'archive_restore_event', suffix: ['sourceId'], kind: 'event' },
  { action: 'archive_restore_event', suffix: ['restoredId'], kind: 'event' },
  { action: 'archive_restore_tournament', suffix: ['sourceId'], kind: 'tournament' },
  { action: 'archive_restore_tournament', suffix: ['restoredId'], kind: 'tournament' },
  { action: 'custom_ruleset.clone', suffix: ['sourceId'], kind: 'custom_ruleset' },
  { action: 'league.scoring_system.cloned', suffix: ['source_id'], kind: 'league_scoring_system' },
  { action: 'fighter.merge_revert', suffix: ['source_id'], kind: 'global_person' },
  { action: 'fighter.merge_revert', suffix: ['target_id'], kind: 'global_person' },
];

const RULE_INDEX: ReadonlyMap<string, EntityKind> = new Map(
  REF_RULES.map((rule) => [`${rule.action ?? '*'}|${rule.suffix.join('.')}`, rule.kind]),
);

export interface PayloadRef {
  /** RFC 6901 JSON Pointer into `payload_json`, e.g. `/moved/personIds/0`. */
  pointer: string;
  kind: EntityKind;
  id: string;
}

/** Shared across a page so one pathological payload cannot starve the rest. */
export interface RefBudget {
  remaining: number;
}

/**
 * RFC 6901. Chosen over dotted/bracket paths because payload keys are
 * unvalidated developer input from ~20 call sites: a key containing `.` or `[`
 * makes a dotted path ambiguous, and the frontend has to rebuild the exact same
 * string to look a label up.
 */
export function jsonPointer(segments: readonly (string | number)[]): string {
  return segments
    .map((segment) => String(segment).replace(/~/g, '~0').replace(/\//g, '~1'))
    .reduce((acc, segment) => `${acc}/${segment}`, '');
}

/** Action-scoped rules win, then global; longest suffix first within each. */
function matchRule(action: string, matchPath: readonly string[]): EntityKind | null {
  for (let length = Math.min(MAX_SUFFIX, matchPath.length); length >= 1; length -= 1) {
    const suffix = matchPath.slice(matchPath.length - length).join('.');
    const scoped = RULE_INDEX.get(`${action}|${suffix}`);
    if (scoped) return scoped;
  }
  for (let length = Math.min(MAX_SUFFIX, matchPath.length); length >= 1; length -= 1) {
    const suffix = matchPath.slice(matchPath.length - length).join('.');
    const global = RULE_INDEX.get(`*|${suffix}`);
    if (global) return global;
  }
  return null;
}

/**
 * Walk `payload` and return every entity reference it carries.
 *
 * Only UUID-shaped strings are candidates, so non-uuid `entity_id` sentinels
 * ('batch', 'traefik') and free-text fields never reach the database.
 */
export function collectPayloadRefs(
  action: string,
  payload: unknown,
  budget: RefBudget,
): PayloadRef[] {
  const refs: PayloadRef[] = [];
  let nodes = 0;

  const visit = (
    node: unknown,
    matchPath: string[],
    pointerPath: (string | number)[],
    depth: number,
  ): void => {
    if (budget.remaining <= 0 || depth > MAX_DEPTH || (nodes += 1) > MAX_NODES) return;

    if (Array.isArray(node)) {
      node.forEach((child, index) => {
        // Index elided from matchPath: one rule covers every element.
        visit(child, matchPath, [...pointerPath, index], depth + 1);
      });
      return;
    }
    if (node !== null && typeof node === 'object') {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        visit(child, [...matchPath, key], [...pointerPath, key], depth + 1);
      }
      return;
    }
    if (typeof node !== 'string' || !UUID_RE.test(node)) return;

    const kind = matchRule(action, matchPath);
    if (!kind) return;
    refs.push({ pointer: jsonPointer(pointerPath), kind, id: node });
    budget.remaining -= 1;
  };

  visit(payload, [], [], 0);
  return refs;
}

export const __testing = { UUID_RE, MAX_DEPTH, MAX_NODES };
