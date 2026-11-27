import { beforeEach, describe, expect, it } from 'vitest';
import { filtersFor, queriedTables, selectsFor } from '../../../common/testing/supabase-chain';
import { draftBracket, type DraftBracketArgs } from './draft-tools';
import {
  assertOrgRole,
  caller,
  createDraftFromAction,
  EVENT,
  forbidden,
  harness,
  id,
  LINK,
  PHASE,
  resetWorld,
  savedDraft,
  TOURNAMENT,
  withoutLink,
  world,
} from './draft-tools.test-helper';
import { expectNoRawIds } from './no-raw-ids.test-helper';

const READABLE = [
  {
    kind: 'generate_bracket',
    tournament: { name: 'Longsword Open' },
    phaseType: 'single_elim',
    qualifyCount: 16,
  },
];

function run(over: Partial<DraftBracketArgs> = {}) {
  const h = harness();
  const args = { event: 'fal-2026', tournament: 'longsword-open', qualifyCount: 16, ...over };
  return { h, result: draftBracket(args, caller, h.deps) };
}

beforeEach(() => {
  resetWorld();
  // The decoys: another Tournament's bracket, and this Tournament's Pools.
  world.decoys = [
    { id: id(23), tournament_id: id(21), type: 'double_elim' },
    { id: PHASE, tournament_id: TOURNAMENT, type: 'pool' },
  ];
  createDraftFromAction.mockResolvedValue(
    savedDraft({ draftType: 'bracket_plan', readable: READABLE }),
  );
});

describe('draft_bracket saves one draft', () => {
  it('of one generate_bracket action, from Claude, and answers it by name with its link', async () => {
    const { h, result } = run({ phaseType: 'single_elim', bracketSize: 16 });
    const answer = await result;
    expect(createDraftFromAction).toHaveBeenCalledTimes(1);
    expect(createDraftFromAction).toHaveBeenCalledWith(
      EVENT,
      caller.userId,
      [
        {
          kind: 'generate_bracket',
          tournamentId: TOURNAMENT,
          phaseType: 'single_elim',
          qualifyCount: 16,
          bracketSize: 16,
        },
      ],
      {
        source: 'mcp',
        auditExtra: { via: 'mcp', clientId: caller.clientId, clientName: 'Claude' },
      },
    );
    expect(answer).toEqual({ draft: READABLE, link: LINK, status: 'ready' });
    expectNoRawIds(withoutLink(answer));
    // This Tournament's bracket of either type only: its Pools and another's bracket are not.
    expect(selectsFor(h.supabase.from, 'phases')).toEqual(['id']);
    expect(filtersFor(h.supabase.from, 'phases', 'eq')).toEqual([['tournament_id', TOURNAMENT]]);
    expect(filtersFor(h.supabase.from, 'phases', 'in')).toEqual([
      ['type', ['single_elim', 'double_elim']],
    ]);
  });

  it('naming no setting Claude did not give', async () => {
    const { result } = run({ qualifyCount: undefined });
    await result;
    const [, , actions] = createDraftFromAction.mock.calls[0]!;
    expect(actions).toEqual([{ kind: 'generate_bracket', tournamentId: TOURNAMENT }]);
  });

  it('with a size but no count: the count is the registrations at Apply, and Apply asks', async () => {
    const { result } = run({ qualifyCount: undefined, bracketSize: 12 });
    expect(await result).toEqual({ draft: READABLE, link: LINK, status: 'ready' });
    const [, , actions] = createDraftFromAction.mock.calls[0]!;
    expect(actions).toEqual([
      { kind: 'generate_bracket', tournamentId: TOURNAMENT, bracketSize: 12 },
    ]);
  });
});

describe('draft_bracket refuses', () => {
  it('in maintenance, before any other read', async () => {
    world.readOnly = true;
    const { h, result } = run();
    expect(await result).toEqual({
      refusal: 'MyClash is in maintenance: nothing can change right now.',
    });
    expect(queriedTables(h.supabase.from)).toEqual(['feature_flags']);
    expect(createDraftFromAction).not.toHaveBeenCalled();
  });

  it('an Event it cannot find', async () => {
    const { result } = run({ event: 'nope' });
    expect(await result).toEqual({ refusal: 'No Event "nope" that you can see.' });
    expect(createDraftFromAction).not.toHaveBeenCalled();
  });

  it("a Tournament the Event does not have, another Event's included", async () => {
    const { result } = run({ tournament: 'sabre-open' });
    expect(await result).toEqual({
      refusal: 'No Tournament "sabre-open" at FAL 2026 that you can see.',
    });
    expect(createDraftFromAction).not.toHaveBeenCalled();
  });

  it('a caller who is not an org admin, before the Tournament is read', async () => {
    assertOrgRole.mockRejectedValue(forbidden());
    const { h, result } = run();
    expect(await result).toEqual({
      refusal: "Only the organisation's admins can make drafts at FAL 2026.",
    });
    expect(queriedTables(h.supabase.from)).toEqual(['feature_flags', 'events', 'events']);
    expect(createDraftFromAction).not.toHaveBeenCalled();
  });

  it.each(['completed', 'archived'])('an Event that is %s', async (status) => {
    world.eventStatus = status;
    const { result } = run();
    expect(await result).toEqual({ refusal: 'FAL 2026 is over: nothing there can change now.' });
    expect(createDraftFromAction).not.toHaveBeenCalled();
  });

  it.each(['single_elim', 'double_elim'])('a Tournament that has a %s bracket', async (type) => {
    world.phases = [{ id: id(30), tournament_id: TOURNAMENT, type }];
    const { result } = run();
    expect(await result).toEqual({
      refusal: 'The Tournament "longsword-open" already has a bracket. Change it in MyClash.',
    });
    expect(createDraftFromAction).not.toHaveBeenCalled();
  });

  it.each([
    [{ qualifyCount: 16, bracketSize: 8 }, 'bracketSize (8) must be ≥ fighterCount (16)'],
    [
      { qualifyCount: 8, bracketSize: 12, phaseType: 'double_elim' as const },
      'bracketSize must be a power of 2 (got 12)',
    ],
  ])('a bracket Generate Bracket cannot build: %o', async (shape, words) => {
    const { result } = run(shape);
    const answer = await result;
    expect(answer).toEqual({ refusal: `MyClash cannot build this bracket: ${words}.` });
    expectNoRawIds(answer);
    expect(createDraftFromAction).not.toHaveBeenCalled();
  });

  it('a draft the shape check failed, with its errors and no link', async () => {
    createDraftFromAction.mockResolvedValue(
      savedDraft({
        status: 'failed',
        validationState: {
          ok: false,
          warnings: [],
          errors: ['Bracket draft tournamentId is required'],
        },
      }),
    );
    const { result } = run();
    expect(await result).toEqual({
      refusal: 'MyClash cannot use this draft: Bracket draft tournamentId is required.',
    });
  });
});
