/**
 * The ruleset pair a new Tournament is created with (ruling "TF_v1 version"):
 * the latest version of a built-in when none is named, the one named
 * otherwise, and never a pair that does not resolve.
 */
import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventsService } from './events.service';
import { createRulesetRegistry } from '../rulesets/ruleset-registry';
import {
  assertOrgRole,
  makeChain,
  makeTournamentsChain,
  seedHarness,
} from './create-tournament.fixtures';

describe('createTournament — its ruleset pair', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertOrgRole.mockResolvedValue(undefined);
  });

  it('gives a new Tournament the latest version of its built-in when none is named', async () => {
    const { svc, version } = seedHarness();
    await svc.createTournament('e1', { slug: 's', name: 'T', rulesetCode: 'TF_v1' } as never, 'u1');
    expect(version()).toBe('1.1.0');
  });

  it('keeps the version the caller names, "1" stored as 1.0.0', async () => {
    const { svc, version } = seedHarness();
    const dto = { slug: 's', name: 'T', rulesetCode: 'TF_v1', rulesetVersion: '1' };
    await svc.createTournament('e1', dto as never, 'u1');
    expect(version()).toBe('1.0.0');
  });

  it('refuses a ruleset pair that does not resolve, before anything is written', async () => {
    const { svc, version, from } = seedHarness();
    const dto = { slug: 's', name: 'T', rulesetCode: 'custom_gone', rulesetVersion: '1.0.0' };
    await expect(svc.createTournament('e1', dto as never, 'u1')).rejects.toThrow(
      'The selected ruleset (custom_gone 1.0.0) does not exist.',
    );
    expect(version()).toBeUndefined();
    expect(from).not.toHaveBeenCalledWith('custom_ruleset_versions');
  });

  it("accepts a club pair only as the picker offers it to the Event's organisation", async () => {
    // An organiser of org-1 who knows the code of another club's private
    // ruleset: the picker does not offer it, so the door refuses it, in the
    // words it uses for a pair that does not exist.
    const { svc, version, isSelectable } = seedHarness();
    const dto = { slug: 's', name: 'T', rulesetCode: 'custom_theirs', rulesetVersion: '1.0.0' };
    await expect(svc.createTournament('e1', dto as never, 'u1')).rejects.toThrow(
      'The selected ruleset (custom_theirs 1.0.0) does not exist.',
    );
    expect(isSelectable).toHaveBeenCalledWith('org-1', 'custom_theirs', '1.0.0', {
      withDrafts: false,
    });
    expect(version()).toBeUndefined();
  });

  it('offers the platform drafts as the picker does, to whom `draftsOfferedTo` names', async () => {
    const { svc, version, isSelectable, draftsOfferedTo } = seedHarness({
      customRow: { code: 'custom_draft' },
    });
    draftsOfferedTo.mockResolvedValue(true);
    const dto = { slug: 's', name: 'T', rulesetCode: 'custom_draft', rulesetVersion: '1.0.0' };
    await svc.createTournament('e1', dto as never, 'u1');
    expect(draftsOfferedTo).toHaveBeenCalledWith('u1');
    expect(isSelectable).toHaveBeenCalledWith('org-1', 'custom_draft', '1.0.0', {
      withDrafts: true,
    });
    expect(version()).toBe('1.0.0');
  });

  it('asks the picker nothing for a built-in', async () => {
    const { svc, isSelectable } = seedHarness();
    await svc.createTournament('e1', { slug: 's', name: 'T', rulesetCode: 'TF_v1' } as never, 'u1');
    expect(isSelectable).not.toHaveBeenCalled();
  });

  it("answers a checker missing as the server's fault, not the caller's", async () => {
    const event = { data: { id: 'e1', organization_id: 'org-1', status: 'draft' }, error: null };
    const from = vi.fn((table: string) =>
      table === 'events' ? makeChain(event) : makeTournamentsChain({ current: null }),
    );
    const svc = new EventsService(
      { service: { from } } as never,
      { assertOrgRole } as never,
      {} as never,
      createRulesetRegistry(),
    );
    const dto = { slug: 's', name: 'T', rulesetCode: 'custom_x', rulesetVersion: '1.0.0' };
    const refusal = await svc.createTournament('e1', dto as never, 'u1').catch((e: unknown) => e);
    expect((refusal as Error).message).toBe(
      'Ruleset picker unavailable; cannot check the ruleset.',
    );
    expect(refusal).not.toBeInstanceOf(HttpException);
  });
});
