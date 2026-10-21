import { describe, expect, it } from 'vitest';
import {
  CLUB_START_FORFEIT_RULES,
  FFAMHE_FORFEIT_RULES,
  type ForfeitRules,
} from '@myclash/types/forfeit-rules';
import { mockSupabase, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import { CreatePenaltyRulesetDto, UpdatePenaltyRulesetDto } from './dto/penalties.dto';
import { PenaltiesService } from './penalties.service';
import { buildPenaltyVersionRow, penaltyRowOfVersion } from './penalty-version.util';
import { fighterStatusDouble } from '../matches/fighter-status.fixtures';

/**
 * A penalty ruleset owns its forfeit rules (operator rulings 63-76, 2026-10-20): every door that
 * writes or copies one carries them, and none of them invents a value. A MARKER value is one no
 * start value holds, so a door that wrote a default instead is seen.
 */

const MARKER: ForfeitRules = {
  ...CLUB_START_FORFEIT_RULES,
  disqualifyAfter: 7,
  blackCardOpponentScore: 13,
};

const ROW = {
  id: 'pr-1',
  code: 'house',
  version: '1.0.0',
  name: 'House cards',
  description: null,
  owner_organization_id: 'org-1',
  built_in: false,
  accumulation_scope: 'tournament',
  yellow_card_points: 0,
  red_card_points: -1,
  black_card_points: 0,
  first_black_card_forfeit: 'match',
  second_black_card_forfeit: 'tournament',
  forfeit_rules: MARKER,
  penalty_ruleset_entries: [],
};

/** A club's penalty ruleset nobody pins, its snapshot `ver-1`, and an admin of its club. */
function penalties(more: Record<string, unknown>[] = []) {
  const db = mockSupabase(
    {
      penalty_rulesets: { rows: [ROW, ...more], returning: { id: 'pr-1' } },
      penalty_ruleset_entries: { rows: [] },
      penalty_ruleset_versions: {
        rows: [{ ...ROW, id: 'ver-1', penalty_ruleset_id: 'pr-1', entries: [] }],
      },
      tournaments: { rows: [] },
      events: { rows: [] },
      platform_roles: { rows: [] },
    },
    { card_ruleset_held_by_a_bout: () => ({ data: false, error: null }) },
  );
  return {
    db,
    service: new PenaltiesService(
      db as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      fighterStatusDouble(),
    ),
  };
}

const CREATE = {
  ownerOrganizationId: 'org-1',
  code: 'house',
  version: '1.0.0',
  name: 'House cards',
  accumulationScope: 'tournament' as const,
  publicVisibility: false,
  entries: [],
};

const writtenTo = (db: ReturnType<typeof penalties>['db'], op: string) =>
  writesTo(db, 'penalty_rulesets')
    .filter((write) => write.op === op)
    .map((write) => write.row as Record<string, unknown>);

describe('the doors that write a penalty ruleset carry its forfeit rules', () => {
  it('a create writes the rules it is sent', async () => {
    const { db, service } = penalties();

    await service.createRuleset({ ...CREATE, forfeitRules: MARKER }, 'user-1');

    expect(writtenTo(db, 'insert')[0]).toMatchObject({ forfeit_rules: MARKER });
  });

  it('a create sent none leaves them to the column, a new club ruleset’s start (ruling 67)', async () => {
    const { db, service } = penalties();

    await service.createRuleset(CREATE, 'user-1');

    expect(writtenTo(db, 'insert')[0]).not.toHaveProperty('forfeit_rules');
  });

  it('an edit writes the rules it is sent', async () => {
    const { db, service } = penalties();

    await service.updateRuleset('pr-1', { forfeitRules: MARKER } as never, 'user-1');

    expect(writtenTo(db, 'update')[0]).toMatchObject({ forfeit_rules: MARKER });
  });

  it('an export carries them, and an import of that file writes them', async () => {
    const { service } = penalties();
    const file = await service.exportRulesetJson('pr-1', 'user-1');
    expect(file.definition).toMatchObject({ forfeitRules: MARKER });

    const into = penalties();
    await into.service.importRulesetJson('org-1', file, 'user-1');
    expect(writtenTo(into.db, 'insert')[0]).toMatchObject({ forfeit_rules: MARKER });
  });

  it('an import of a file made before the move leaves them to the column', async () => {
    const { service } = penalties();
    const file = await service.exportRulesetJson('pr-1', 'user-1');
    const { forfeitRules: _none, ...older } = file.definition as Record<string, unknown>;

    const into = penalties();
    await into.service.importRulesetJson('org-1', { ...file, definition: older }, 'user-1');
    expect(writtenTo(into.db, 'insert')[0]).not.toHaveProperty('forfeit_rules');
  });

  it('a snapshot holds them, and a rollback writes them back', async () => {
    expect(buildPenaltyVersionRow(ROW)).toMatchObject({ forfeit_rules: MARKER });
    expect(penaltyRowOfVersion({ ...ROW, forfeit_rules: MARKER })).toMatchObject({
      forfeit_rules: MARKER,
    });

    const { db, service } = penalties();
    await service.rollbackRuleset('pr-1', 'ver-1', 'user-1');
    expect(writtenTo(db, 'update')[0]).toMatchObject({ forfeit_rules: MARKER });
  });

  it('the lineage lamp sees a ruleset that changed only its forfeit rules', async () => {
    const builtIn = { ...ROW, id: 'ffamhe', built_in: true, owner_organization_id: null };
    const { db, service } = penalties([{ ...builtIn, forfeit_rules: FFAMHE_FORFEIT_RULES }]);

    const lineage = await service.describeRulesetLineage('pr-1', 'user-1');

    expect(lineage?.status).toBe('changed');
    // The double hands back whole rows: only the projection proves the column is read.
    const lineageReads = selectsFor(db.from, 'penalty_rulesets').filter((select) =>
      select.includes('accumulation_scope'),
    );
    expect(lineageReads).not.toHaveLength(0);
    for (const select of lineageReads) expect(select).toContain('forfeit_rules');
  });
});

/** A create body the schema takes but for its forfeit rules: its owner is a uuid. */
const CREATE_BODY = { ...CREATE, ownerOrganizationId: '0f0f0f0f-0000-4000-8000-000000000001' };

describe('the forfeit rules a door accepts', () => {
  it.each([
    ['an opponent score of 0', { ...MARKER, blackCardOpponentScore: 0 }],
    ['"disqualify after" 11', { ...MARKER, disqualifyAfter: 11 }],
    ['Off spelled null', { ...MARKER, disqualifyAfter: null }],
    ['a key the rules do not have', { ...MARKER, forfeitDrawsCount: true }],
    ['a reason with no rule', { ...MARKER, reasons: { injury: MARKER.reasons.injury } }],
  ])('refuse %s, on a create and on an edit', (_what, forfeitRules) => {
    expect(CreatePenaltyRulesetDto.schema.safeParse({ ...CREATE_BODY, forfeitRules }).success).toBe(
      false,
    );
    expect(UpdatePenaltyRulesetDto.schema.safeParse({ forfeitRules }).success).toBe(false);
  });

  it('take the rules and Off, on a create and on an edit', () => {
    const off = { ...MARKER, disqualifyAfter: 'off' };
    for (const forfeitRules of [MARKER, off]) {
      expect(
        CreatePenaltyRulesetDto.schema.safeParse({ ...CREATE_BODY, forfeitRules }).success,
      ).toBe(true);
      expect(UpdatePenaltyRulesetDto.schema.safeParse({ forfeitRules }).success).toBe(true);
    }
  });
});
