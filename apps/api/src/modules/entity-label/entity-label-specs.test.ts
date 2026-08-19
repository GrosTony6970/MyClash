/**
 * The label specs turn a raw id in the audit log into something a person can
 * read. Nothing held them: no test named LABEL_SPECS, ENTITY_TYPE_TO_KIND or
 * labelKey, so the table was free to rot.
 *
 * Two of the properties here are the kind a mock cannot reach.
 *
 * The projection is one. EntityLabelService passes `spec.columns` straight to
 * `.select()`, and a mocked Supabase client ignores what it is given — delete a
 * column and every test stays green while production breaks. The service then
 * reads `row['id']` and SKIPS any row without a string one, so a projection that
 * forgets `id` does not error: it silently labels nothing and the reader is left
 * looking at UUIDs. Both are pinned below, verbatim.
 *
 * The embed flip is the other. PostgREST returns an embedded row as an object
 * or as an array depending on the foreign key's cardinality, which is why
 * `embed()` handles both. A fixture that only ever uses one shape proves half
 * the function.
 *
 * Exhaustiveness is already the compiler's job — LABEL_SPECS is typed
 * `Record<Exclude<EntityKind, 'user'>, …>`, so a new kind cannot be added
 * without a spec. The table below inherits that type, so a new kind must be
 * described here too.
 */
import { describe, expect, it } from 'vitest';
import { ENTITY_TYPE_TO_KIND, LABEL_SPECS, labelKey, type EntityKind } from './entity-label-specs';

const EXPECTED: Record<Exclude<EntityKind, 'user'>, { table: string; columns: string }> = {
  event: { table: 'events', columns: 'id, name' },
  tournament: { table: 'tournaments', columns: 'id, name' },
  organization: { table: 'organizations', columns: 'id, name' },
  club: { table: 'clubs', columns: 'id, name' },
  league: { table: 'leagues', columns: 'id, name' },
  league_scoring_system: { table: 'league_scoring_systems', columns: 'id, name' },
  phase: { table: 'phases', columns: 'id, type, tournaments(name)' },
  match: {
    table: 'matches',
    columns: 'id, match_number_label, phases(type, tournaments(name))',
  },
  exchange: { table: 'exchanges', columns: 'id, sequence, type' },
  global_person: {
    table: 'global_persons',
    columns: 'id, display_name, given_name, family_name',
  },
  person: { table: 'persons', columns: 'id, given_name, family_name' },
  registration: { table: 'registrations', columns: 'id, persons(given_name, family_name)' },
  workshop_instructor: { table: 'workshop_instructors', columns: 'id, display_name' },
  custom_ruleset: { table: 'custom_rulesets', columns: 'id, display_name' },
  custom_ruleset_version: { table: 'custom_ruleset_versions', columns: 'id, name, version' },
  league_scoring_system_version: {
    table: 'league_scoring_system_versions',
    columns: 'id, name, version',
  },
  league_membership_request: {
    table: 'league_membership_requests',
    columns: 'id, leagues(name), clubs(name)',
  },
  organizer_ai_assistant_draft: {
    table: 'organizer_ai_assistant_drafts',
    columns: 'id, draft_type, summary',
  },
  organizer_chat_conversation: { table: 'organizer_chat_conversations', columns: 'id, title' },
  deletion_request: { table: 'deletion_requests', columns: 'id, target_type, status' },
  exchange_edit_request: { table: 'exchange_edit_requests', columns: 'id, request_type, status' },
  event_broadcast_notification: {
    table: 'event_broadcast_notifications',
    columns: 'id, title',
  },
  audit_log: { table: 'audit_log', columns: 'id, action, created_at' },
};

describe('the query each spec sends', () => {
  it('reads exactly these tables and these columns', () => {
    const actual = Object.fromEntries(
      Object.entries(LABEL_SPECS).map(([kind, spec]) => [
        kind,
        { table: spec.table, columns: spec.columns },
      ]),
    );

    expect(actual).toEqual(EXPECTED);
  });

  it('selects id for every kind, because the resolver drops a row without one', () => {
    for (const [kind, spec] of Object.entries(LABEL_SPECS)) {
      const first = spec.columns.split(',')[0]?.trim();
      expect(first, `${kind} must select id`).toBe('id');
    }
  });
});

describe('the PostgREST embed flip', () => {
  it('reads a phase tournament as an object or as an array', () => {
    const base = { id: 'phase-1', type: 'pool' };

    expect(LABEL_SPECS.phase.label({ ...base, tournaments: { name: 'Longsword' } })).toBe(
      'Longsword · pool',
    );
    expect(LABEL_SPECS.phase.label({ ...base, tournaments: [{ name: 'Longsword' }] })).toBe(
      'Longsword · pool',
    );
  });

  it('reads a match through two nested embeds in either shape', () => {
    const base = { id: 'match-1', match_number_label: 'L1-P1-M01' };

    expect(
      LABEL_SPECS.match.label({
        ...base,
        phases: { type: 'pool', tournaments: { name: 'Longsword' } },
      }),
    ).toBe('Longsword · pool · L1-P1-M01');
    expect(
      LABEL_SPECS.match.label({
        ...base,
        phases: [{ type: 'pool', tournaments: [{ name: 'Longsword' }] }],
      }),
    ).toBe('Longsword · pool · L1-P1-M01');
  });

  it('reads a registration person in either shape', () => {
    const person = { given_name: 'Ada', family_name: 'Lovelace' };

    expect(LABEL_SPECS.registration.label({ id: 'reg-1', persons: person })).toBe('Ada Lovelace');
    expect(LABEL_SPECS.registration.label({ id: 'reg-1', persons: [person] })).toBe('Ada Lovelace');
  });

  it('reads both sides of a league membership request in either shape', () => {
    expect(
      LABEL_SPECS.league_membership_request.label({
        id: 'req-1',
        clubs: { name: 'Lyon AMHE' },
        leagues: { name: 'FFAMHE' },
      }),
    ).toBe('Lyon AMHE → FFAMHE');
    expect(
      LABEL_SPECS.league_membership_request.label({
        id: 'req-1',
        clubs: [{ name: 'Lyon AMHE' }],
        leagues: [{ name: 'FFAMHE' }],
      }),
    ).toBe('Lyon AMHE → FFAMHE');
  });
});

describe('what a spec makes of a row', () => {
  it('trims the text it reads', () => {
    expect(LABEL_SPECS.event.label({ id: 'event-1', name: '  Demo Open  ' })).toBe('Demo Open');
  });

  it('ignores a value that is not text', () => {
    expect(LABEL_SPECS.event.label({ id: 'event-1', name: 42 })).toBe(null);
  });

  it('returns null rather than an empty label, so the caller keeps the raw id', () => {
    expect(LABEL_SPECS.event.label({ id: 'event-1', name: '   ' })).toBe(null);
    expect(LABEL_SPECS.person.label({ id: 'person-1', given_name: '', family_name: '' })).toBe(
      null,
    );
    expect(LABEL_SPECS.registration.label({ id: 'reg-1', persons: null })).toBe(null);
  });

  it('prefers a global person display name over the given and family names', () => {
    const names = { given_name: 'Ada', family_name: 'Lovelace' };

    expect(
      LABEL_SPECS.global_person.label({ id: 'gp-1', display_name: 'Ada the Blade', ...names }),
    ).toBe('Ada the Blade');
    expect(LABEL_SPECS.global_person.label({ id: 'gp-1', display_name: '', ...names })).toBe(
      'Ada Lovelace',
    );
  });

  it('numbers an exchange, and says so even when the sequence is missing', () => {
    expect(LABEL_SPECS.exchange.label({ id: 'x-1', sequence: 3, type: 'clean' })).toBe(
      '#3 · clean',
    );
    expect(LABEL_SPECS.exchange.label({ id: 'x-1', type: 'clean' })).toBe('#? · clean');
  });

  it('prefers a draft summary over its bare type', () => {
    const base = { id: 'draft-1', draft_type: 'schedule' };

    expect(LABEL_SPECS.organizer_ai_assistant_draft.label({ ...base, summary: 'Two lices' })).toBe(
      'Two lices',
    );
    expect(LABEL_SPECS.organizer_ai_assistant_draft.label({ ...base, summary: '' })).toBe(
      'schedule',
    );
  });

  it('names a ruleset version as name and version', () => {
    expect(
      LABEL_SPECS.custom_ruleset_version.label({ id: 'v-1', name: 'House rules', version: '2' }),
    ).toBe('House rules v2');
  });

  it('dates an audit entry to the day, not the millisecond', () => {
    expect(
      LABEL_SPECS.audit_log.label({
        id: 'log-1',
        action: 'match.void',
        created_at: '2026-08-19T10:11:12.000Z',
      }),
    ).toBe('match.void · 2026-08-19');
  });
});

describe('the audit_log entity_type registry', () => {
  it('maps exactly these entity_type values', () => {
    expect(ENTITY_TYPE_TO_KIND).toEqual({
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
    });
  });

  it('points every entity_type at a kind that can actually be labelled', () => {
    for (const [entityType, kind] of Object.entries(ENTITY_TYPE_TO_KIND)) {
      // `user` is absent from LABEL_SPECS on purpose: it routes through
      // UserDirectoryService, because there is no public.users table.
      if (kind === 'user') continue;
      expect(LABEL_SPECS[kind as Exclude<EntityKind, 'user'>], entityType).toBeDefined();
    }
  });
});

describe('labelKey', () => {
  it('keys a label by its kind and its id', () => {
    expect(labelKey('event', 'event-1')).toBe('event:event-1');
    expect(labelKey('user', 'user-1')).toBe('user:user-1');
  });
});
