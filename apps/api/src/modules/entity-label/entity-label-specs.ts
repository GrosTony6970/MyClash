/**
 * entity-label-specs.ts — how each entity kind turns into a human label.
 *
 * Pure data, no Nest, no queries. Split out of the resolver on purpose: the old
 * `fetchLabelsForType` switch was one 130-line method and the only entry this
 * file's package had in the complexity baseline. Kinds grow; a table of specs
 * grows without producing a longer function.
 */

export type EntityKind =
  | 'event'
  | 'tournament'
  | 'phase'
  | 'match'
  | 'exchange'
  | 'organization'
  | 'club'
  | 'league'
  | 'global_person'
  | 'person'
  | 'registration'
  | 'workshop_instructor'
  | 'user'
  | 'custom_ruleset'
  | 'custom_ruleset_version'
  | 'league_scoring_system'
  | 'league_scoring_system_version'
  | 'league_membership_request'
  | 'organizer_ai_assistant_draft'
  | 'organizer_chat_conversation'
  | 'deletion_request'
  | 'exchange_edit_request'
  | 'event_broadcast_notification'
  | 'audit_log';

type Row = Record<string, unknown>;

export interface EntityLabelSpec {
  table: string;
  columns: string;
  /** Null when the row carries nothing human-readable — the caller keeps the raw id. */
  label(row: Row): string | null;
}

function text(row: Row, key: string): string {
  const value = row[key];
  return typeof value === 'string' ? value.trim() : '';
}

/** PostgREST flips an embed between object and array depending on the FK cardinality. */
function embed(row: Row, key: string): Row | null {
  const value = row[key];
  if (Array.isArray(value)) return (value[0] as Row | undefined) ?? null;
  return (value as Row | null) ?? null;
}

function fullName(row: Row | null): string {
  if (!row) return '';
  return (
    text(row, 'display_name') || `${text(row, 'given_name')} ${text(row, 'family_name')}`.trim()
  );
}

function nonEmpty(value: string): string | null {
  return value || null;
}

/**
 * `user` is absent on purpose — it routes through UserDirectoryService, which
 * falls back to auth.users for accounts that never claimed a person record.
 * There is no `public.users` table (see 0023_global_persons.sql).
 */
export const LABEL_SPECS: Record<Exclude<EntityKind, 'user'>, EntityLabelSpec> = {
  event: { table: 'events', columns: 'id, name', label: (r) => nonEmpty(text(r, 'name')) },
  tournament: {
    table: 'tournaments',
    columns: 'id, name',
    label: (r) => nonEmpty(text(r, 'name')),
  },
  organization: {
    table: 'organizations',
    columns: 'id, name',
    label: (r) => nonEmpty(text(r, 'name')),
  },
  club: { table: 'clubs', columns: 'id, name', label: (r) => nonEmpty(text(r, 'name')) },
  league: { table: 'leagues', columns: 'id, name', label: (r) => nonEmpty(text(r, 'name')) },
  league_scoring_system: {
    table: 'league_scoring_systems',
    columns: 'id, name',
    label: (r) => nonEmpty(text(r, 'name')),
  },
  phase: {
    table: 'phases',
    columns: 'id, type, tournaments(name)',
    label: (r) => nonEmpty(`${text(embed(r, 'tournaments') ?? {}, 'name')} · ${text(r, 'type')}`),
  },
  match: {
    table: 'matches',
    columns: 'id, match_number_label, phases(type, tournaments(name))',
    label: (r) => {
      const phase = embed(r, 'phases');
      const tournament = phase ? embed(phase, 'tournaments') : null;
      const parts = [
        text(tournament ?? {}, 'name'),
        text(phase ?? {}, 'type'),
        text(r, 'match_number_label'),
      ];
      return nonEmpty(parts.filter(Boolean).join(' · '));
    },
  },
  exchange: {
    table: 'exchanges',
    columns: 'id, sequence, type',
    label: (r) => nonEmpty([`#${String(r['sequence'] ?? '?')}`, text(r, 'type')].join(' · ')),
  },
  global_person: {
    table: 'global_persons',
    columns: 'id, display_name, given_name, family_name',
    label: (r) => nonEmpty(fullName(r)),
  },
  person: {
    table: 'persons',
    columns: 'id, given_name, family_name',
    label: (r) => nonEmpty(fullName(r)),
  },
  registration: {
    table: 'registrations',
    columns: 'id, persons(given_name, family_name)',
    label: (r) => nonEmpty(fullName(embed(r, 'persons'))),
  },
  workshop_instructor: {
    table: 'workshop_instructors',
    columns: 'id, display_name',
    label: (r) => nonEmpty(text(r, 'display_name')),
  },
  custom_ruleset: {
    table: 'custom_rulesets',
    columns: 'id, display_name',
    label: (r) => nonEmpty(text(r, 'display_name')),
  },
  custom_ruleset_version: {
    table: 'custom_ruleset_versions',
    columns: 'id, name, version',
    label: (r) => nonEmpty(`${text(r, 'name')} v${text(r, 'version')}`.trim()),
  },
  league_scoring_system_version: {
    table: 'league_scoring_system_versions',
    columns: 'id, name, version',
    label: (r) => nonEmpty(`${text(r, 'name')} v${text(r, 'version')}`.trim()),
  },
  league_membership_request: {
    table: 'league_membership_requests',
    columns: 'id, leagues(name), clubs(name)',
    label: (r) =>
      nonEmpty(
        `${text(embed(r, 'clubs') ?? {}, 'name')} → ${text(embed(r, 'leagues') ?? {}, 'name')}`,
      ),
  },
  organizer_ai_assistant_draft: {
    // The table has draft_type/prompt/summary — no `title`. Selecting a column
    // that does not exist makes PostgREST reject the whole query.
    table: 'organizer_ai_assistant_drafts',
    columns: 'id, draft_type, summary',
    label: (r) => nonEmpty(text(r, 'summary') || text(r, 'draft_type')),
  },
  organizer_chat_conversation: {
    table: 'organizer_chat_conversations',
    columns: 'id, title',
    label: (r) => nonEmpty(text(r, 'title')),
  },
  deletion_request: {
    table: 'deletion_requests',
    columns: 'id, target_type, status',
    label: (r) => nonEmpty(`${text(r, 'target_type')} · ${text(r, 'status')}`),
  },
  exchange_edit_request: {
    table: 'exchange_edit_requests',
    columns: 'id, request_type, status',
    label: (r) => nonEmpty(`${text(r, 'request_type')} · ${text(r, 'status')}`),
  },
  event_broadcast_notification: {
    table: 'event_broadcast_notifications',
    columns: 'id, title',
    label: (r) => nonEmpty(text(r, 'title')),
  },
  audit_log: {
    table: 'audit_log',
    columns: 'id, action, created_at',
    label: (r) => nonEmpty(`${text(r, 'action')} · ${text(r, 'created_at').slice(0, 10)}`),
  },
};

/**
 * `audit_log.entity_type` is free TEXT with no enum behind it, so this map is
 * the de-facto registry of which values we know how to label.
 *
 * Deliberately absent: `feature_flag`, `system_component`, `system_tls`,
 * `weapon_catalog` — their `entity_id` is already a readable key, not a UUID.
 */
export const ENTITY_TYPE_TO_KIND: Readonly<Record<string, EntityKind>> = {
  event: 'event',
  tournament: 'tournament',
  phase: 'phase',
  exchange: 'exchange',
  fighter: 'global_person',
  user: 'user',
  organization: 'organization',
  club: 'club',
  league: 'league',
  custom_ruleset: 'custom_ruleset',
  league_membership_request: 'league_membership_request',
  league_scoring_system: 'league_scoring_system',
  organizer_ai_assistant_draft: 'organizer_ai_assistant_draft',
  exchange_edit_request: 'exchange_edit_request',
  deletion_request: 'deletion_request',
};

export function labelKey(kind: EntityKind, id: string): string {
  return `${kind}:${id}`;
}
