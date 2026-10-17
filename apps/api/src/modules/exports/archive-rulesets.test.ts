/**
 * A restore is a door that sets a Tournament's ruleset pair, and a bout's
 * (ruling "Restore a pair", 2026-10-18). The stories: Mallory hand-edits an
 * archive so its Tournament names Club B's private ruleset and restores it into
 * her own Event; Club A restores last season's Event, pinned to Club A's own
 * ruleset at 1.0.0, since published again as 1.0.1. The first is refused before
 * anything is written; the second restores as it was.
 */
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import { createRulesetRegistry } from '../rulesets/ruleset-registry';
import { assertRestoredRulesetsUsable } from './archive-rulesets';
import { ArchiveService } from './archive.service';
import { emptyArchiveTables } from './archive.tables';

function doubles(restorable: (code: string) => boolean = () => true) {
  const selectable = {
    draftsOfferedTo: vi.fn(async () => false),
    restorable: vi.fn(async (_org: string, code: string) => restorable(code)),
  };
  return { registry: createRulesetRegistry(), selectable: selectable as never, spy: selectable };
}

function tables(tournaments: object[], matches: object[] = []) {
  return { ...emptyArchiveTables(), tournaments, matches } as never;
}

describe('assertRestoredRulesetsUsable', () => {
  it('lets a built-in through with no read, a stored "1" read as 1.0.0', async () => {
    const rulesets = doubles();
    const data = tables([
      { ruleset_code: 'TF_v1', ruleset_version: '1' },
      { ruleset_code: 'Generic_PointsCap', ruleset_version: '1.1.0' },
    ]);
    await assertRestoredRulesetsUsable(rulesets, data, 'org-a', 'u1');
    expect(rulesets.spy.restorable).not.toHaveBeenCalled();
    expect(rulesets.spy.draftsOfferedTo).not.toHaveBeenCalled();
  });

  it("asks once per club pair, of the Tournaments and the bouts, in the target club's scope", async () => {
    const rulesets = doubles();
    const data = tables(
      [{ ruleset_code: 'custom_own', ruleset_version: '1.0.0' }],
      [
        // An older bout row spells the version "1": the same pair, 1.0.0.
        { ruleset_code: 'custom_own', ruleset_version: '1' },
        { ruleset_code: 'custom_shared', ruleset_version: '2.0.0' },
      ],
    );
    await assertRestoredRulesetsUsable(rulesets, data, 'org-a', 'u1');
    expect(rulesets.spy.restorable.mock.calls).toEqual([
      ['org-a', 'custom_own', '1.0.0', { withDrafts: false }],
      ['org-a', 'custom_shared', '2.0.0', { withDrafts: false }],
    ]);
    expect(rulesets.spy.draftsOfferedTo).toHaveBeenCalledTimes(1);
    expect(rulesets.spy.draftsOfferedTo).toHaveBeenCalledWith('u1');
  });

  it('refuses a row whose ruleset is not a code, and skips one that names none', async () => {
    const rulesets = doubles();
    await expect(
      assertRestoredRulesetsUsable(rulesets, tables([{ ruleset_code: null }]), 'org-a', 'u1'),
    ).rejects.toThrow('names a ruleset that is not a code');
    const noVersion = tables([{ ruleset_code: 'TF_v1', ruleset_version: null }]);
    await expect(assertRestoredRulesetsUsable(rulesets, noVersion, 'org-a', 'u1')).rejects.toThrow(
      'not a code and a version',
    );
    await assertRestoredRulesetsUsable(rulesets, tables([{ id: 't-1' }]), 'org-a', 'u1');
    expect(rulesets.spy.restorable).not.toHaveBeenCalled();
  });

  it("refuses another club's private ruleset, on a bout as on a Tournament", async () => {
    const theirs = (code: string) => code !== 'custom_theirs';
    for (const data of [
      tables([{ ruleset_code: 'custom_theirs', ruleset_version: '1.0.4' }]),
      tables([], [{ ruleset_code: 'custom_theirs', ruleset_version: '1.0.4' }]),
    ]) {
      await expect(
        assertRestoredRulesetsUsable(doubles(theirs), data, 'org-a', 'u1'),
      ).rejects.toThrow(
        new BadRequestException(
          'This archive names a ruleset this organisation may not use (custom_theirs 1.0.4). Nothing was restored.',
        ),
      );
    }
  });
});

describe('ArchiveService restore: a ruleset the target club may not keep', () => {
  const archive = (rulesetCode: string, scope: 'event' | 'tournament' = 'event') =>
    Buffer.from(
      JSON.stringify({
        manifest: 'myclash.archive.v1',
        version: 1,
        generatedAt: new Date().toISOString(),
        scope,
        include: 'structure',
        source: { eventId: 'e-b', eventSlug: 'away', eventName: 'Away', eventStatus: 'completed' },
        data: {
          events: [
            {
              id: 'e-b',
              organization_id: 'org-a',
              slug: 'away',
              name: 'Away',
              status: 'completed',
            },
          ],
          tournaments: [
            {
              id: 't-1',
              event_id: 'e-b',
              slug: 'ls',
              name: 'LS',
              ruleset_code: rulesetCode,
              ruleset_version: '1.0.0',
            },
          ],
        },
        reports: { tournaments: [] },
      }),
    );

  function build(restorable: boolean) {
    const target = { id: 'e-a', organization_id: 'org-a', slug: 'home', status: 'draft' };
    const db = mockSupabase({
      events: { rows: [target] },
      tournaments: { rows: [] },
      lices: { rows: [] },
      audit_log: { rows: [] },
    });
    const rulesets = doubles(() => restorable);
    const orgs = { assertOrgRole: vi.fn(async () => undefined) };
    const service = new ArchiveService(
      { service: db.service } as never,
      orgs as never,
      rulesets.registry,
      rulesets.selectable,
    );
    return { db, service, rulesets };
  }

  it('is refused before anything is written', async () => {
    const { db, service, rulesets } = build(false);
    await expect(
      service.restoreArchiveCopy(archive('custom_theirs'), 'u1', {
        targetOrganizationId: 'org-a',
        confirmation: 'RESTORE MYCLASH ARCHIVE',
      }),
    ).rejects.toThrow('may not use (custom_theirs 1.0.0)');
    expect(rulesets.spy.restorable).toHaveBeenCalledWith('org-a', 'custom_theirs', '1.0.0', {
      withDrafts: false,
    });
    // Nothing at all: no Event, no Tournament, no audit row.
    expect(db.writes).toEqual([]);
  });

  it('is refused on a Tournament restore too, before anything is written', async () => {
    const { db, service, rulesets } = build(false);
    await expect(
      service.restoreArchiveCopy(archive('custom_theirs', 'tournament'), 'u1', {
        targetEventId: 'e-a',
        confirmation: 'RESTORE MYCLASH ARCHIVE',
      }),
    ).rejects.toThrow('may not use (custom_theirs 1.0.0)');
    expect(rulesets.spy.restorable).toHaveBeenCalledWith('org-a', 'custom_theirs', '1.0.0', {
      withDrafts: false,
    });
    expect(db.writes).toEqual([]);
  });

  it("restores the club's own ruleset as it was", async () => {
    const { db, service } = build(true);
    await service.restoreArchiveCopy(archive('custom_own', 'tournament'), 'u1', {
      targetEventId: 'e-a',
      confirmation: 'RESTORE MYCLASH ARCHIVE',
    });
    const [restored] = writesTo(db, 'tournaments').flatMap((write) =>
      Array.isArray(write.row) ? write.row : [write.row],
    ) as Record<string, unknown>[];
    expect(restored).toMatchObject({ ruleset_code: 'custom_own', ruleset_version: '1.0.0' });
  });
});
