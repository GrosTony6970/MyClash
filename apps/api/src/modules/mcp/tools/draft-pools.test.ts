import { beforeEach, describe, expect, it } from 'vitest';
import { filtersFor, queriedTables, selectsFor } from '../../../common/testing/supabase-chain';
import { draftPools, type DraftPoolsArgs } from './draft-tools';
import {
  assertOrgRole,
  caller,
  createDraftFromAction,
  EVENT,
  forbidden,
  harness,
  id,
  LINK,
  resetWorld,
  savedDraft,
  TOURNAMENT,
  withoutLink,
  world,
} from './draft-tools.test-helper';
import { expectNoRawIds } from './no-raw-ids.test-helper';

function run(over: Partial<DraftPoolsArgs> = {}) {
  const h = harness();
  const args = { event: 'fal-2026', tournament: 'longsword-open', poolCount: 4, ...over };
  return { h, result: draftPools(args, caller, h.deps) };
}

beforeEach(() => resetWorld());

describe('draft_pools saves one draft', () => {
  it('of one generate_pools action, from Claude, and answers it by name with its link', async () => {
    const { h, result } = run({ schoolSeparation: true, skillBalance: false });
    const answer = await result;
    expect(createDraftFromAction).toHaveBeenCalledTimes(1);
    expect(createDraftFromAction).toHaveBeenCalledWith(
      EVENT,
      caller.userId,
      [
        {
          kind: 'generate_pools',
          tournamentId: TOURNAMENT,
          poolCount: 4,
          enforceSchoolSeparation: true,
          enforceSkillBalance: false,
        },
      ],
      {
        source: 'mcp',
        auditExtra: { via: 'mcp', clientId: caller.clientId, clientName: 'Claude' },
      },
    );
    expect(answer).toEqual({
      draft: [{ kind: 'generate_pools', tournament: { name: 'Longsword Open' }, poolCount: 4 }],
      link: LINK,
      status: 'ready',
    });
    expectNoRawIds(withoutLink(answer));
    // This Tournament's Pool phase only: another Tournament's Pools and this one's bracket are not.
    expect(selectsFor(h.supabase.from, 'phases')).toEqual(['id']);
    expect(filtersFor(h.supabase.from, 'phases', 'eq')).toEqual([['tournament_id', TOURNAMENT]]);
    expect(filtersFor(h.supabase.from, 'phases', 'in')).toEqual([['type', ['pool']]]);
  });

  it('by target size, naming no setting Claude did not give', async () => {
    const { result } = run({ poolCount: undefined, targetSize: 6 });
    await result;
    const [, , actions] = createDraftFromAction.mock.calls[0]!;
    expect(actions).toEqual([{ kind: 'generate_pools', tournamentId: TOURNAMENT, targetSize: 6 }]);
  });
});

describe('draft_pools refuses', () => {
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

  it('a Tournament that already has Pools', async () => {
    world.phases = [{ id: id(30), tournament_id: TOURNAMENT, type: 'pool' }];
    const { result } = run();
    expect(await result).toEqual({
      refusal: 'The Tournament "longsword-open" already has Pools. Change them in MyClash.',
    });
    expect(createDraftFromAction).not.toHaveBeenCalled();
  });

  it('a draft the shape check failed, with its errors and no link', async () => {
    createDraftFromAction.mockResolvedValue(
      savedDraft({
        status: 'failed',
        validationState: {
          ok: false,
          warnings: [],
          errors: [
            'Pool draft requires poolCount or targetSize',
            'Pool draft tournamentId is required',
          ],
        },
      }),
    );
    const { result } = run();
    expect(await result).toEqual({
      refusal:
        'MyClash cannot use this draft: Pool draft requires poolCount or targetSize; Pool draft tournamentId is required.',
    });
  });
});
