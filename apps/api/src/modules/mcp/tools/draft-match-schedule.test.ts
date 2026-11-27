import { BadRequestException, ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { READ_PAGE } from '../../../common/postgrest-in-list';
import { filtersFor, queriedTables, selectsFor } from '../../../common/testing/supabase-chain';
import {
  draftMatchSchedule,
  type DraftMatchScheduleArgs,
  type DraftPlacement,
} from './draft-match-schedule';
import {
  ARENE,
  assertOrgRole,
  bout,
  caller,
  createDraftFromAction,
  EVENT,
  forbidden,
  harness,
  id,
  LINK,
  M04,
  M05,
  PHASE,
  PISTE_2,
  PISTE_3,
  placeMatches,
  resetWorld,
  savedDraft,
  TOURNAMENT,
  withoutLink,
  world,
} from './draft-tools.test-helper';
import { expectNoRawIds } from './no-raw-ids.test-helper';
import { MATCH_SELECT } from './referee-write-gate';

const READABLE = [
  {
    kind: 'schedule_match',
    match: { code: 'LSW-P2-M04', tournament: 'Longsword Open' },
    piste: { name: 'Piste 2' },
    startsAt: '2026-03-14T13:30:00.000Z',
    timezone: 'Europe/Paris',
  },
];

/** Marie's two placements: LSW-P2-M04 on Piste 2 and LSW-P2-M05 on Piste 3, both at 14:30. */
const STORY: DraftPlacement[] = [
  { match: 'LSW-P2-M04', piste: 'Piste 2', start: '2026-03-14 14:30' },
  { match: 'LSW-P2-M05', piste: 'Piste 3', start: '2026-03-14 14:30' },
];

function run(placements: DraftPlacement[] = STORY, over: Partial<DraftMatchScheduleArgs> = {}) {
  const h = harness();
  const args = { event: 'fal-2026', tournament: 'longsword-open', placements, ...over };
  return { h, result: draftMatchSchedule(args, caller, h.deps) };
}

const actionsSaved = () => createDraftFromAction.mock.calls[0]![2] as unknown[];

const placing = (over: Partial<DraftPlacement>): DraftPlacement[] => [{ ...STORY[0]!, ...over }];

beforeEach(() => {
  resetWorld();
  createDraftFromAction.mockResolvedValue(
    savedDraft({ draftType: 'schedule_grid', readable: READABLE }),
  );
});

describe('draft_match_schedule saves one draft', () => {
  it('of one schedule_match action per placement, from Claude, with its link', async () => {
    const { h, result } = run();
    const answer = await result;
    expect(createDraftFromAction).toHaveBeenCalledTimes(1);
    expect(createDraftFromAction).toHaveBeenCalledWith(
      EVENT,
      caller.userId,
      [
        // 14:30 in Paris in March (UTC+1).
        {
          kind: 'schedule_match',
          matchId: M04,
          liceId: PISTE_2,
          scheduledAt: '2026-03-14T13:30:00.000Z',
        },
        {
          kind: 'schedule_match',
          matchId: M05,
          liceId: PISTE_3,
          scheduledAt: '2026-03-14T13:30:00.000Z',
        },
      ],
      {
        source: 'mcp',
        auditExtra: { via: 'mcp', clientId: caller.clientId, clientName: 'Claude' },
      },
    );
    expect(answer).toEqual({ draft: READABLE, link: LINK, status: 'ready' });
    expectNoRawIds(withoutLink(answer));
    // The Tournament's bouts, read once for every code, page by page until an empty one;
    // another Tournament's are not read.
    expect(selectsFor(h.supabase.from, 'matches')).toEqual([MATCH_SELECT, MATCH_SELECT]);
    expect(filtersFor(h.supabase.from, 'matches', 'in')).toEqual([
      ['phase_id', [PHASE]],
      ['phase_id', [PHASE]],
    ]);
    expect(filtersFor(h.supabase.from, 'matches', 'order')).toEqual([['id'], ['id']]);
    expect(filtersFor(h.supabase.from, 'matches', 'gt')).toEqual([['id', M05]]);
    expect(filtersFor(h.supabase.from, 'matches', 'limit')).toEqual([[READ_PAGE], [READ_PAGE]]);
    // The slug, the Tournament gate, then its name and phases.
    expect(selectsFor(h.supabase.from, 'tournaments')).toEqual([
      'id',
      'status, events!inner(id, status, organization_id, event_kind)',
      'name, phases(id)',
    ]);
    expect(filtersFor(h.supabase.from, 'tournaments', 'eq').at(-1)).toEqual(['id', TOURNAMENT]);
    // The Event's pistes, read once: another Event's Piste 2 is not one of them.
    expect(selectsFor(h.supabase.from, 'lices')).toEqual(['id, name']);
    expect(filtersFor(h.supabase.from, 'lices', 'eq')).toEqual([['event_id', EVENT]]);
  });

  it("stores a time in a New York Event as the instant of New York's wall clock", async () => {
    world.timezone = 'America/New_York';
    await run(placing({})).result;
    // 14:30 in New York in March, after its clocks went forward (UTC-4).
    expect(actionsSaved()).toEqual([
      {
        kind: 'schedule_match',
        matchId: M04,
        liceId: PISTE_2,
        scheduledAt: '2026-03-14T18:30:00.000Z',
      },
    ]);
  });

  it('finds a Match code case-blind and a piste case- and accent-blind', async () => {
    await run(placing({ match: 'lsw-p2-m04', piste: ' ARENE ' })).result;
    expect(actionsSaved()).toEqual([
      {
        kind: 'schedule_match',
        matchId: M04,
        liceId: ARENE,
        scheduledAt: '2026-03-14T13:30:00.000Z',
      },
    ]);
  });

  it('after the placement owner checked every placement together, writing nothing', async () => {
    await run().result;
    expect(placeMatches).toHaveBeenCalledTimes(1);
    expect(placeMatches).toHaveBeenCalledWith(
      EVENT,
      [
        { matchId: M04, liceId: PISTE_2, scheduledAt: '2026-03-14T13:30:00.000Z' },
        { matchId: M05, liceId: PISTE_3, scheduledAt: '2026-03-14T13:30:00.000Z' },
      ],
      { checkOnly: true },
    );
    expect(placeMatches.mock.invocationCallOrder[0]!).toBeLessThan(
      createDraftFromAction.mock.invocationCallOrder[0]!,
    );
  });
});

describe('draft_match_schedule refuses', () => {
  it('placements on a busy piste, in its own words: the owner names a bout by id', async () => {
    placeMatches.mockRejectedValue(
      new ConflictException(
        `Piste already busy: this bout overlaps match ${M05} on the same piste`,
      ),
    );
    const answer = await run().result;
    expect(answer).toEqual({
      refusal:
        'A piste in this draft is busy at that time: a bout overlaps another one on its piste, ' +
        'in this draft or already in the schedule. Change the time or the piste.',
    });
    expectNoRawIds(answer);
    expect(createDraftFromAction).not.toHaveBeenCalled();
  });

  it('nothing when the check fails otherwise: the generic failure, not a refusal', async () => {
    placeMatches.mockRejectedValue(new BadRequestException('matches read failed'));
    await expect(run().result).rejects.toThrow('matches read failed');
    expect(createDraftFromAction).not.toHaveBeenCalled();
  });

  async function refused(placements: DraftPlacement[] = STORY) {
    const answer = await run(placements).result;
    expect(createDraftFromAction).not.toHaveBeenCalled();
    return answer;
  }

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
    const { result } = run(STORY, { event: 'nope' });
    expect(await result).toEqual({ refusal: 'No Event "nope" that you can see.' });
    expect(createDraftFromAction).not.toHaveBeenCalled();
  });

  it("a Tournament the Event does not have, another Event's included", async () => {
    const { result } = run(STORY, { tournament: 'sabre-open' });
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
    expect(await refused()).toEqual({
      refusal: 'FAL 2026 is over: nothing there can change now.',
    });
  });

  it('a Match code the Tournament does not have', async () => {
    expect(await refused(placing({ match: 'LSW-P9-M01' }))).toEqual({
      refusal: 'No Match "LSW-P9-M01" in Longsword Open.',
    });
  });

  it('a Match code two of its bouts share', async () => {
    world.matches = [...world.matches, bout({ id: id(53), match_number_label: 'M04' })];
    expect(await refused()).toEqual({
      refusal:
        'Several Matches of Longsword Open are "LSW-P2-M04": MyClash cannot tell them apart.',
    });
  });

  it('a piste the Event does not have, naming its pistes', async () => {
    expect(await refused(placing({ piste: 'Piste 9' }))).toEqual({
      refusal: 'No piste "Piste 9" at FAL 2026; its pistes are: Piste 2, Piste 3, Arène.',
    });
  });

  it('a piste at an Event that has none', async () => {
    world.lices = [];
    expect(await refused()).toEqual({
      refusal: 'No piste "Piste 2" at FAL 2026; its pistes are: none.',
    });
  });

  it('a piste name two of its pistes share', async () => {
    world.lices = [...world.lices, { id: id(44), event_id: EVENT, name: 'piste 2' }];
    expect(await refused()).toEqual({
      refusal: 'Several pistes at FAL 2026 are "Piste 2": MyClash cannot tell them apart.',
    });
  });

  it.each(['14:30', '2026-03-14T14:30', '2026-03-14 25:00', '2026-02-30 14:30', 'tomorrow 2pm'])(
    'a start it cannot read: %s',
    async (start) => {
      expect(await refused(placing({ start }))).toEqual({
        refusal:
          `MyClash cannot read the start "${start}" of LSW-P2-M04: give it as ` +
          'YYYY-MM-DD HH:MM on the clock of FAL 2026.',
      });
    },
  );

  it('the same Match placed twice, whatever the case of its code', async () => {
    const twice = [STORY[0]!, { match: 'lsw-p2-m04', piste: 'Piste 3', start: '2026-03-14 15:00' }];
    expect(await refused(twice)).toEqual({
      refusal: 'lsw-p2-m04 is placed twice: give each Match one place in a draft.',
    });
  });

  it('a draft the shape check failed, with its errors and no link', async () => {
    createDraftFromAction.mockResolvedValue(
      savedDraft({
        status: 'failed',
        validationState: { ok: false, warnings: [], errors: ['Schedule liceId is required'] },
      }),
    );
    expect(await run().result).toEqual({
      refusal: 'MyClash cannot use this draft: Schedule liceId is required.',
    });
  });
});
