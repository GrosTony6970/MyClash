import { describe, expect, it } from 'vitest';
import { type RefBudget, collectPayloadRefs, jsonPointer } from './audit-payload-refs';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

function collect(action: string, payload: unknown, remaining = 100) {
  const budget: RefBudget = { remaining };
  return { refs: collectPayloadRefs(action, payload, budget), budget };
}

describe('collectPayloadRefs', () => {
  it('matches both camelCase and snake_case key names at the top level', () => {
    const { refs } = collect('org.update', { orgId: A, organization_id: B, tournamentId: C });
    expect(refs).toEqual([
      { pointer: '/orgId', kind: 'organization', id: A },
      { pointer: '/organization_id', kind: 'organization', id: B },
      { pointer: '/tournamentId', kind: 'tournament', id: C },
    ]);
  });

  it('resolves ids nested inside a whole-row snapshot', () => {
    const { refs } = collect('exchange_edit_request.approve', {
      request: { event_id: A, match_id: B, requested_by_user_id: C },
    });
    expect(refs).toEqual([
      { pointer: '/request/event_id', kind: 'event', id: A },
      { pointer: '/request/match_id', kind: 'match', id: B },
      { pointer: '/request/requested_by_user_id', kind: 'user', id: C },
    ]);
  });

  it('disambiguates a bare `id` by its parent key, and ignores it at the root', () => {
    const { refs } = collect('fighter.merge', {
      id: A,
      source: { id: B },
      exchange: { id: C },
    });
    // `/id` has no rule: `id` alone means nothing, and a wrong label is worse
    // than a missing one in an audit record.
    expect(refs).toEqual([
      { pointer: '/source/id', kind: 'global_person', id: B },
      { pointer: '/exchange/id', kind: 'exchange', id: C },
    ]);
  });

  it('walks arrays, eliding the index when matching but keeping it in the pointer', () => {
    const { refs } = collect('fighter.merge', {
      moved: { personIds: [A, B], workshopInstructorIds: [C] },
    });
    expect(refs).toEqual([
      { pointer: '/moved/personIds/0', kind: 'person', id: A },
      { pointer: '/moved/personIds/1', kind: 'person', id: B },
      { pointer: '/moved/workshopInstructorIds/0', kind: 'workshop_instructor', id: C },
    ]);
  });

  it('resolves an ambiguous key differently per action, and not at all without one', () => {
    expect(collect('archive_restore_event', { sourceId: A }).refs[0]?.kind).toBe('event');
    expect(collect('archive_restore_tournament', { sourceId: A }).refs[0]?.kind).toBe('tournament');
    expect(collect('custom_ruleset.clone', { sourceId: A }).refs[0]?.kind).toBe('custom_ruleset');
    expect(collect('some.unmapped.action', { sourceId: A }).refs).toEqual([]);
  });

  it('never emits a ref for a value that is not UUID-shaped', () => {
    // `entity_id: 'batch'` is real (clubs.service bulk actions); probing it
    // would raise 22P02 invalid input syntax for type uuid.
    const { refs } = collect('club.bulk_archive', {
      orgId: 'batch',
      eventId: 'not-a-uuid',
      tournamentId: 42,
      leagueId: null,
      match_id: '',
    });
    expect(refs).toEqual([]);
  });

  it('stops at the shared budget and leaves nothing for the next payload', () => {
    const budget: RefBudget = { remaining: 2 };
    const first = collectPayloadRefs('x', { moved: { personIds: [A, B, C] } }, budget);
    expect(first).toHaveLength(2);
    expect(budget.remaining).toBe(0);
    expect(collectPayloadRefs('x', { orgId: A }, budget)).toEqual([]);
  });

  it('stops descending past the depth cap', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: { event_id: A } } } } } } } };
    expect(collect('x', deep).refs).toEqual([]);
    const shallow = { a: { b: { c: { d: { event_id: A } } } } };
    expect(collect('x', shallow).refs).toEqual([
      { pointer: '/a/b/c/d/event_id', kind: 'event', id: A },
    ]);
  });

  it('terminates on a pathologically wide payload', () => {
    const wide: Record<string, string> = {};
    for (let i = 0; i < 5000; i += 1) wide[`k${i}`] = A;
    expect(() => collect('x', wide)).not.toThrow();
  });

  it('tolerates a null or scalar payload', () => {
    expect(collect('x', null).refs).toEqual([]);
    expect(collect('x', 'a string').refs).toEqual([]);
    expect(collect('x', undefined).refs).toEqual([]);
  });
});

describe('jsonPointer', () => {
  it('escapes ~ and / per RFC 6901', () => {
    expect(jsonPointer(['a/b'])).toBe('/a~1b');
    expect(jsonPointer(['a~b'])).toBe('/a~0b');
    expect(jsonPointer(['moved', 'personIds', 0])).toBe('/moved/personIds/0');
  });

  it('produces a pointer the walker and the frontend can both rebuild', () => {
    const { refs } = collect('x', { 'weird/key~here': { event_id: A } });
    expect(refs[0]?.pointer).toBe('/weird~1key~0here/event_id');
  });
});
