import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { filtersFor, queriedTables, selectsFor } from '../../../common/testing/supabase-chain';
import { draftTournament, type DraftTournamentArgs } from './draft-tools';
import {
  assertOrgRole,
  caller,
  createDraftFromAction,
  EVENT,
  forbidden,
  getClient,
  harness,
  LINK,
  ORG,
  resetWorld,
  savedDraft,
  usableRulesetVersion,
  withoutLink,
  world,
} from './draft-tools.test-helper';
import { expectNoRawIds } from './no-raw-ids.test-helper';

const READABLE = [
  { kind: 'create_tournament', name: 'Sabre Open', slug: 'sabre-open', rulesetCode: 'TF_v1' },
];

function run(over: Partial<DraftTournamentArgs> = {}, domain?: string | null) {
  const h = harness(domain);
  const args = { event: 'fal-2026', name: 'Sabre Open', slug: 'sabre-open', ...over };
  return { h, result: draftTournament(args, caller, h.deps) };
}

beforeEach(() => {
  resetWorld();
  createDraftFromAction.mockResolvedValue(
    savedDraft({ draftType: 'tournament_config', readable: READABLE }),
  );
});

describe('draft_tournament saves one draft', () => {
  it('of one create_tournament action, from Claude, and answers it by name with its link', async () => {
    const { h, result } = run({ weapon: 'longsword' });
    const answer = await result;
    expect(createDraftFromAction).toHaveBeenCalledTimes(1);
    expect(createDraftFromAction).toHaveBeenCalledWith(
      EVENT,
      caller.userId,
      [
        {
          kind: 'create_tournament',
          name: 'Sabre Open',
          slug: 'sabre-open',
          weapon: 'Longsword',
          rulesetCode: 'TF_v1',
        },
      ],
      {
        source: 'mcp',
        auditExtra: { via: 'mcp', clientId: caller.clientId, clientName: 'Claude' },
      },
    );
    expect(answer).toEqual({ draft: READABLE, link: LINK, status: 'ready' });
    expectNoRawIds(withoutLink(answer));
    expect(getClient).toHaveBeenCalledWith(caller.clientId);
    // The slug is looked for in this Event only: another Event's `sabre-open` does not count.
    expect(selectsFor(h.supabase.from, 'tournaments')).toEqual(['id']);
    expect(filtersFor(h.supabase.from, 'tournaments', 'eq')).toEqual([
      ['event_id', EVENT],
      ['slug', 'sabre-open'],
    ]);
    expect(selectsFor(h.supabase.from, 'weapon_catalog')).toEqual(['name']);
    expect(filtersFor(h.supabase.from, 'weapon_catalog', 'eq')).toEqual([['active', true]]);
  });

  it("reads the Event's organisation for the admin bar and the link", async () => {
    const { h, result } = run();
    await result;
    expect(selectsFor(h.supabase.from, 'events')[1]).toBe(
      'organization_id, organizations!inner(slug)',
    );
    expect(filtersFor(h.supabase.from, 'events', 'eq')[1]).toEqual(['id', EVENT]);
    expect(assertOrgRole).toHaveBeenCalledWith(ORG, caller.userId, 'admin');
  });

  it('with the ruleset named, checked as Create Tournament checks it', async () => {
    const { result } = run({ ruleset: 'custom_fal-1' });
    await result;
    expect(usableRulesetVersion).toHaveBeenCalledWith(
      'custom_fal-1',
      undefined,
      { organization_id: ORG },
      caller.userId,
    );
    const [, , actions] = createDraftFromAction.mock.calls[0]!;
    expect(actions).toEqual([
      {
        kind: 'create_tournament',
        name: 'Sabre Open',
        slug: 'sabre-open',
        rulesetCode: 'custom_fal-1',
      },
    ]);
  });
});

describe('draft_tournament refuses', () => {
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

  it('a caller who is not an org admin', async () => {
    assertOrgRole.mockRejectedValue(forbidden());
    const { result } = run();
    expect(await result).toEqual({
      refusal: "Only the organisation's admins can make drafts at FAL 2026.",
    });
    expect(createDraftFromAction).not.toHaveBeenCalled();
  });

  it.each(['completed', 'archived'])('an Event that is %s', async (status) => {
    world.eventStatus = status;
    const { result } = run();
    expect(await result).toEqual({ refusal: 'FAL 2026 is over: nothing there can change now.' });
    expect(createDraftFromAction).not.toHaveBeenCalled();
  });

  it('a slug the Event already has', async () => {
    const { result } = run({ slug: 'longsword-open' });
    expect(await result).toEqual({
      refusal: 'FAL 2026 already has a Tournament "longsword-open".',
    });
    expect(createDraftFromAction).not.toHaveBeenCalled();
  });

  it('a weapon the catalogue does not hold, or holds inactive', async () => {
    for (const weapon of ['Rapier', 'Sabre']) {
      const { result } = run({ weapon });
      expect(await result).toEqual({
        refusal: `MyClash has no weapon "${weapon}" in its catalogue.`,
      });
    }
    expect(createDraftFromAction).not.toHaveBeenCalled();
  });

  it("a ruleset the Event's organisation cannot use", async () => {
    usableRulesetVersion.mockRejectedValue(new BadRequestException('does not exist'));
    const { result } = run({ ruleset: 'custom_other-1' });
    expect(await result).toEqual({
      refusal: 'MyClash has no ruleset "custom_other-1" that FAL 2026 can use.',
    });
    expect(createDraftFromAction).not.toHaveBeenCalled();
  });

  it('a draft the shape check failed, with its errors and no link', async () => {
    createDraftFromAction.mockResolvedValue(
      savedDraft({
        status: 'failed',
        validationState: { ok: false, warnings: [], errors: ['Tournament name is required'] },
      }),
    );
    const { result } = run({ name: '  ' });
    expect(await result).toEqual({
      refusal: 'MyClash cannot use this draft: Tournament name is required.',
    });
  });
});

describe('draft_tournament fails', () => {
  it('before it saves, when the server has no DOMAIN for the link', async () => {
    const { result } = run({}, null);
    await expect(result).rejects.toThrow('no DOMAIN');
    expect(createDraftFromAction).not.toHaveBeenCalled();
  });

  it('when a check throws something other than a refusal', async () => {
    usableRulesetVersion.mockRejectedValue(new Error('ruleset read failed'));
    const { result } = run();
    await expect(result).rejects.toThrow('ruleset read failed');
    assertOrgRole.mockRejectedValue(new Error('membership read failed'));
    await expect(run().result).rejects.toThrow('membership read failed');
    expect(createDraftFromAction).not.toHaveBeenCalled();
  });
});
