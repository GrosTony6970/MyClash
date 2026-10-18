/**
 * The restore of an archive made before migration 0229 gives its bouts copies of their rules
 * (ruling "Old archives", operator 2026-10-17); a newer archive restores its own copies, and calls
 * neither function. Through `restoreArchiveCopy`, so the step is proved where the restore runs it:
 * after the Tournaments are written, before the bouts.
 */
import { describe, expect, it } from 'vitest';
import { lastFunctionParams } from '../../common/testing/migration-function';
import type { RpcAnswer } from '../../common/testing/supabase-chain';
import { carriesBoutsWithoutCopies } from './archive-match-rules';
import { makeService } from './archive.fixtures';

const EVENT = {
  id: 'event-1',
  organization_id: 'org-1',
  slug: 'fal',
  name: 'FAL',
  status: 'draft',
};
const TOURNAMENT = {
  id: 't-1',
  event_id: 'event-1',
  slug: 'longsword',
  name: 'Longsword',
  ruleset_code: 'Generic_PointsCap',
  ruleset_version: '1.0.0',
};

/** An Event archive with these tables; `matches` and `matchRules` as given. */
function archiveOf(include: 'structure' | 'scoring', tables: Record<string, unknown>) {
  return Buffer.from(
    JSON.stringify({
      manifest: 'myclash.archive.v1',
      version: 1,
      generatedAt: '2026-10-01T10:00:00.000Z',
      scope: 'event',
      include,
      source: { eventId: 'event-1', eventSlug: 'fal', eventName: 'FAL', eventStatus: 'completed' },
      data: {
        events: [EVENT],
        tournaments: [TOURNAMENT],
        phases: [{ id: 'ph-1', tournament_id: 't-1', type: 'pool' }],
        ...tables,
      },
      reports: { tournaments: [] },
    }),
  );
}

const restore = (service: ReturnType<typeof makeService>['service'], buffer: Buffer) =>
  service.restoreArchiveCopy(buffer, 'user-1', {
    targetOrganizationId: 'org-1',
    confirmation: 'RESTORE MYCLASH ARCHIVE',
  });

/** Each bout's state, its engine pair and hash, as an archive made before 0229 holds it. */
const OLD_BOUTS = [
  { id: 'm-1', phase_id: 'ph-1', status: 'scheduled', ruleset_code: 'TF_v1', ruleset_version: '1' },
  {
    id: 'm-2',
    phase_id: 'ph-1',
    status: 'completed',
    ruleset_code: 'TF_v1',
    ruleset_version: '1',
    ruleset_content_hash: 'hash-fought',
  },
  {
    id: 'm-3',
    phase_id: 'ph-1',
    status: 'completed',
    ruleset_code: 'TF_v1',
    ruleset_version: '1',
    ruleset_content_hash: 'hash-fought',
  },
  {
    id: 'm-4',
    phase_id: 'ph-1',
    status: 'running',
    ruleset_code: 'Generic_PointsCap',
    ruleset_version: '1.0.0',
  },
];

describe('carriesBoutsWithoutCopies', () => {
  it('is an archive with bouts and no copies', () => {
    expect(carriesBoutsWithoutCopies({ matches: [{ id: 'm-1' }] })).toBe(true);
  });

  it('is not an archive that carries copies, even none', () => {
    expect(carriesBoutsWithoutCopies({ matches: [{ id: 'm-1' }], matchRules: [] })).toBe(false);
  });

  it('is not an archive with no bouts', () => {
    expect(carriesBoutsWithoutCopies({ matches: [] })).toBe(false);
    expect(carriesBoutsWithoutCopies({})).toBe(false);
  });
});

describe('restoring an archive made before 0229', () => {
  /** `events`: the Events already in the database (a Tournament restores into one). */
  function oldRestore(events: Record<string, unknown>[] = []) {
    // The tables written when each function was called: both must find the Tournament written,
    // and no bout yet.
    const writtenAtCall: string[][] = [];
    let inserted: Record<string, unknown[]> = {};
    const answer =
      (result: (args: Record<string, unknown>) => unknown): RpcAnswer =>
      (args) => {
        writtenAtCall.push(Object.keys(inserted).sort());
        return { data: result(args), error: null };
      };
    const made = makeService(
      // The copy the stamp makes: the restored Tournament's rules of now.
      {
        events,
        match_rules: [
          {
            id: 'copy-now',
            ruleset_code: 'Generic_PointsCap',
            ruleset_version: '1.0.0',
            ruleset_content_hash: 'hash-now',
          },
        ],
      },
      {
        stamp_match_rules: answer(() => 'copy-now'),
        build_match_rules: answer(
          ({ p_code, p_hash }) => `built-${String(p_code)}-${String(p_hash)}`,
        ),
      },
    );
    inserted = made.inserted;
    return { ...made, writtenAtCall };
  }

  it('gives every bout a copy: one not started the Tournament’s of now', async () => {
    const { service, inserted } = oldRestore();

    await restore(service, archiveOf('scoring', { matches: OLD_BOUTS }));

    const bout = (inserted.matches ?? []).find((row) => row['status'] === 'scheduled');
    // Its own columns follow the copy, as the stamp writes them until the foundation's last commit.
    expect(bout).toMatchObject({
      match_rules_id: 'copy-now',
      ruleset_code: 'Generic_PointsCap',
      ruleset_version: '1.0.0',
      ruleset_content_hash: 'hash-now',
      earlier_rules_ids: [],
    });
  });

  it('gives a bout fought or running a copy with its own engine pair and hash', async () => {
    const { service, inserted } = oldRestore();

    await restore(service, archiveOf('scoring', { matches: OLD_BOUTS }));

    const byState = (inserted.matches ?? []).filter((row) => row['status'] !== 'scheduled');
    expect(byState.map((row) => [row['match_rules_id'], row['ruleset_code']])).toEqual([
      ['built-TF_v1-hash-fought', 'TF_v1'],
      ['built-TF_v1-hash-fought', 'TF_v1'],
      ['built-Generic_PointsCap-null', 'Generic_PointsCap'],
    ]);
  });

  it('asks each function with its own arguments, once per Tournament or pair', async () => {
    const { service, inserted, rpc } = oldRestore();

    await restore(service, archiveOf('scoring', { matches: OLD_BOUTS }));

    const restoredTournament = inserted.tournaments?.[0]?.['id'];
    expect(restoredTournament).not.toBe('t-1');
    expect(rpc.mock.calls).toEqual([
      ['stamp_match_rules', { p_tournament_id: restoredTournament }],
      [
        'build_match_rules',
        {
          p_tournament_id: restoredTournament,
          p_code: 'TF_v1',
          p_version: '1',
          p_hash: 'hash-fought',
        },
      ],
      [
        'build_match_rules',
        {
          p_tournament_id: restoredTournament,
          p_code: 'Generic_PointsCap',
          p_version: '1.0.0',
          p_hash: null,
        },
      ],
    ]);
    // The keys are the functions' own: a double cannot see a renamed one.
    for (const [name, args] of rpc.mock.calls) {
      expect(Object.keys(args ?? {})).toEqual(lastFunctionParams(String(name)));
    }
  });

  it('asks once the Tournament is written and before any bout is', async () => {
    const { service, writtenAtCall } = oldRestore();

    await restore(service, archiveOf('scoring', { matches: OLD_BOUTS }));

    expect(writtenAtCall).toHaveLength(3);
    for (const written of writtenAtCall) {
      expect(written).toContain('tournaments');
      expect(written).not.toContain('matches');
    }
  });

  it('gives the bouts of a Tournament restored on its own the restored Tournament’s copies', async () => {
    // A Tournament archive restores into an Event of the database: its phases point at the
    // Tournament restored, as the restore maps them.
    const { service, inserted, rpc } = oldRestore([EVENT]);
    const archive = JSON.parse(archiveOf('scoring', { matches: OLD_BOUTS }).toString('utf8'));
    archive.scope = 'tournament';
    archive.source = {
      ...archive.source,
      tournamentId: 't-1',
      tournamentSlug: 'longsword',
      tournamentName: 'Longsword',
      tournamentStatus: 'completed',
    };

    await service.restoreArchiveCopy(Buffer.from(JSON.stringify(archive)), 'user-1', {
      targetEventId: 'event-1',
      confirmation: 'RESTORE MYCLASH ARCHIVE',
    });

    const restored = inserted.tournaments?.[0]?.['id'];
    expect(restored).not.toBe('t-1');
    expect(new Set(rpc.mock.calls.map(([, args]) => args?.['p_tournament_id']))).toEqual(
      new Set([restored]),
    );
    expect(inserted.matches?.map((row) => row['match_rules_id'])).toEqual([
      'copy-now',
      'built-TF_v1-hash-fought',
      'built-TF_v1-hash-fought',
      'built-Generic_PointsCap-null',
    ]);
  });

  it('asks nothing for a structure archive: it carries no bouts', async () => {
    // No function is configured: a call throws.
    const { service, inserted } = makeService({ events: [] }, {});

    await restore(service, archiveOf('structure', { matches: [] }));

    expect(inserted.tournaments).toHaveLength(1);
    expect(inserted.matches).toBeUndefined();
  });
});

describe('restoring an archive that carries its copies', () => {
  it('restores its own copies, remapped, and asks neither function', async () => {
    // A finished bout keeps the rules it ended under: the copy it holds travels with it.
    const { service, inserted } = makeService({ events: [] }, {});

    await restore(
      service,
      archiveOf('scoring', {
        matchRules: [{ id: 'mr-1', tournament_id: 't-1', ruleset_code: 'TF_v1', digest: 'd-1' }],
        matches: [{ id: 'm-1', phase_id: 'ph-1', status: 'completed', match_rules_id: 'mr-1' }],
      }),
    );

    const copy = inserted.match_rules?.[0];
    expect(copy?.['id']).not.toBe('mr-1');
    expect(copy?.['tournament_id']).toBe(inserted.tournaments?.[0]?.['id']);
    expect(inserted.matches?.[0]?.['match_rules_id']).toBe(copy?.['id']);
  });
});
