import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  assertOrgRole,
  call,
  chains,
  ORG_ID,
  readOf,
  resetHarness,
  textOf,
  TOURNAMENT_ID,
  VISIBILITY_SELECT,
  world,
} from './tournament-query.test-helper';

const notAMember = () => assertOrgRole.mockRejectedValue(new ForbiddenException('not a member'));

beforeEach(() => {
  resetHarness();
});

describe("the query panel tools in Claude, under the Tournament's setting", () => {
  it('refuses a stranger under organizers_only, naming who the organiser lets ask', async () => {
    notAMember();

    const result = await call('get_tournament_summary', {});

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'The organiser of Longsword Open lets organisers ask about it, and you are not one of them.',
    );
    expect(chains.some((c) => c.table.startsWith('vw_tournament_query_'))).toBe(false);
  });

  it("names the Event's referees under organizers_head_judges", async () => {
    world.policy = 'organizers_head_judges';
    notAMember();

    const result = await call('get_tournament_summary', {});

    expect(textOf(result)).toBe(
      "The organiser of Longsword Open lets organisers and the Event's referees ask about it, " +
        'and you are not one of them.',
    );
  });

  it("names the Event's referees and the roster under the widest setting", async () => {
    world.policy = 'anyone_with_tournament_access';
    notAMember();

    const result = await call('get_tournament_summary', {});

    expect(textOf(result)).toBe(
      "The organiser of Longsword Open lets organisers, the Event's referees and the people on " +
        "the Event's roster ask about it, and you are not one of them.",
    );
  });

  it('answers a setting outside the one list as a failure, not a refusal', async () => {
    world.policy = 'organizers_head_judges_coaches';
    notAMember();

    const result = await call('get_tournament_summary', {});

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('MyClash could not answer this. Try again later.');
  });

  it('lets an Event referee in under organizers_head_judges', async () => {
    world.policy = 'organizers_head_judges';
    world.referee = true;
    notAMember();

    const result = await call('get_tournament_summary', {});

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(textOf(result))).toMatchObject({ title: 'Tournament summary' });
  });

  it('refuses an Event referee under organizers_only', async () => {
    world.referee = true;
    notAMember();

    const result = await call('get_tournament_summary', {});

    expect(textOf(result)).toBe(
      'The organiser of Longsword Open lets organisers ask about it, and you are not one of them.',
    );
  });

  it('answers a failed membership read as a failure, not a refusal', async () => {
    assertOrgRole.mockRejectedValue(new Error('membership read failed: connection reset'));

    const result = await call('get_tournament_summary', {});

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('MyClash could not answer this. Try again later.');
  });

  it('hides a draft Tournament from a non-insider the setting would admit', async () => {
    world.tournamentStatus = 'draft';
    world.policy = 'anyone_with_tournament_access';
    world.referee = true;
    notAMember();

    const result = await call('get_tournament_summary', {});

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('No Tournament "longsword" at FAL 2026 that you can see.');
    expect(textOf(result)).not.toContain('Longsword Open');
    expect(chains.some((c) => c.table.startsWith('vw_tournament_query_'))).toBe(false);
    expect(chains.some((c) => c.table === 'tournament_query_settings')).toBe(false);
    expect(readOf('tournaments', VISIBILITY_SELECT)['eq']!.mock.calls).toEqual([
      ['id', TOURNAMENT_ID],
    ]);
    // The insider check asked the Tournament's organisation, at the lowest member role.
    expect(assertOrgRole).toHaveBeenCalledWith(ORG_ID, 'user-1', 'read_only');
  });

  it('shows a draft Tournament to an organisation member', async () => {
    world.tournamentStatus = 'draft';

    const result = await call('get_tournament_summary', {});

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(textOf(result))).toMatchObject({ title: 'Tournament summary' });
  });
});
