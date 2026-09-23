/**
 * Each of the four penalty-ruleset pin doors holds to `penalty-pin.test.ts`'s
 * rule (operator rulings 64 and 66): the Event default, the Tournament pin,
 * Tournament create and Tournament edit.
 *
 * The story: Club B pins its private ruleset on a published Tournament, whose
 * `penalty_ruleset_id` anyone can read. Mallory, admin of her own club, pinned
 * that id on a Tournament of hers and read Club B's rules through it. Sam, admin
 * of both clubs, could hand Club B's rules to Club A's members the same way.
 *
 * Driven through the real services and org-role check over seeded tables; the
 * refusal must come before anything is written.
 */
import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import { EventsService } from '../events/events.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { createRulesetRegistry } from '../rulesets/ruleset-registry';
import { PenaltiesService } from './penalties.service';

const EVENT_A = '11111111-1111-4111-8111-111111111111';
const TOURNAMENT_A = '33333333-3333-4333-8333-333333333333';
const TOURNAMENT_LEGACY = '44444444-4444-4444-8444-444444444444';
const SHARED_B = '77777777-7777-4777-8777-777777777777';
const PRIVATE_A = '88888888-8888-4888-8888-888888888888';
const PRIVATE_B = '99999999-9999-4999-8999-999999999999';

function ruleset(id: string, fields: Record<string, unknown>) {
  return {
    id,
    name: `ruleset ${id.slice(0, 4)}`,
    description: null,
    accumulation_scope: 'match',
    yellow_card_points: 0,
    red_card_points: -1,
    black_card_points: 0,
    first_black_card_forfeit: 'match',
    second_black_card_forfeit: 'tournament',
    penalty_ruleset_entries: [],
    ...fields,
  };
}

let db: ReturnType<typeof mockSupabase>;
let penalties: PenaltiesService;
let events: EventsService;

beforeEach(() => {
  db = mockSupabase({
    penalty_rulesets: {
      rows: [
        ruleset(PRIVATE_B, {
          version: '1.0.4',
          built_in: false,
          public_visibility: false,
          owner_organization_id: 'org-b',
        }),
        ruleset(PRIVATE_A, {
          version: '2.1.0',
          built_in: false,
          public_visibility: false,
          owner_organization_id: 'org-a',
        }),
        ruleset(SHARED_B, {
          version: '3.0.0',
          built_in: false,
          public_visibility: true,
          owner_organization_id: 'org-b',
        }),
      ],
    },
    penalty_ruleset_versions: { rows: [] },
    events: {
      rows: [{ id: EVENT_A, organization_id: 'org-a', status: 'draft', penalty_ruleset_id: null }],
    },
    tournaments: {
      rows: [
        {
          id: TOURNAMENT_A,
          event_id: EVENT_A,
          slug: 'longsword',
          name: 'Longsword',
          penalty_ruleset_id: null,
        },
        // Pinned while Club B still shared its ruleset; Club B stopped since.
        {
          id: TOURNAMENT_LEGACY,
          event_id: EVENT_A,
          slug: 'sabre-old',
          name: 'Sabre',
          penalty_ruleset_id: PRIVATE_B,
        },
      ],
      // What Tournament create reads back: the row it wrote, with its new id.
      returning: { id: 'tournament-new' },
    },
    // Tournament create reads a custom scoring ruleset's defaults; TF_v1 has none.
    custom_rulesets: { rows: [] },
    phases: { rows: [] },
    matches: { rows: [] },
    organization_members: {
      rows: [
        { organization_id: 'org-a', user_id: 'u-admin-a', role: 'admin' },
        // Sam: admin of both clubs.
        { organization_id: 'org-a', user_id: 'u-admin-ab', role: 'admin' },
        { organization_id: 'org-b', user_id: 'u-admin-ab', role: 'admin' },
      ],
    },
    platform_roles: { rows: [] },
  });
  const supabase = { service: db.service };
  const orgs = new OrganizationsService(db as never);
  penalties = new PenaltiesService(supabase as never, undefined, undefined, orgs);
  events = new EventsService(supabase as never, orgs, {} as never, createRulesetRegistry());
});

interface Door {
  door: string;
  pin: (rulesetId: string, userId: string) => Promise<unknown>;
  table: string;
}

const DOORS: Door[] = [
  {
    door: 'the Event default',
    pin: (id, user) => penalties.assignEventRuleset(EVENT_A, { penaltyRulesetId: id }, user),
    table: 'events',
  },
  {
    door: 'the Tournament pin',
    pin: (id, user) =>
      penalties.assignTournamentRuleset(TOURNAMENT_A, { penaltyRulesetId: id }, user),
    table: 'tournaments',
  },
  {
    door: 'Tournament create',
    pin: (id, user) =>
      events.createTournament(
        EVENT_A,
        { slug: 'sabre', name: 'Sabre', penaltyRulesetId: id } as never,
        user,
      ),
    table: 'tournaments',
  },
  {
    door: 'Tournament edit',
    pin: (id, user) =>
      events.updateTournament(TOURNAMENT_A, { penaltyRulesetId: id } as never, user),
    table: 'tournaments',
  },
];

describe('penalty ruleset pin doors', () => {
  it.each(DOORS)(
    "$door refuses another club's private ruleset, before anything is written",
    async ({ pin, table }) => {
      await expect(pin(PRIVATE_B, 'u-admin-a')).rejects.toBeInstanceOf(BadRequestException);
      expect(writesTo(db, table)).toEqual([]);
      expect(writesTo(db, 'penalty_ruleset_versions')).toEqual([]);
    },
  );

  it.each(DOORS)(
    "$door refuses it to an admin of both clubs: the Event's club decides",
    async ({ pin, table }) => {
      await expect(pin(PRIVATE_B, 'u-admin-ab')).rejects.toBeInstanceOf(BadRequestException);
      expect(writesTo(db, table)).toEqual([]);
    },
  );

  it.each(DOORS)(
    "$door pins the club's own private ruleset and a shared one, at their versions",
    async ({ pin, table }) => {
      for (const [rulesetId, version] of [
        [PRIVATE_A, '2.1.0'],
        [SHARED_B, '3.0.0'],
      ] as const) {
        await pin(rulesetId, 'u-admin-a');
        const pinned = writesTo(db, table).at(-1)?.row as Record<string, unknown> | undefined;
        expect(pinned).toMatchObject({
          penalty_ruleset_id: rulesetId,
          penalty_ruleset_version: version,
        });
      }
    },
  );

  it('Tournament edit lets an unchanged pin through: every settings save re-sends it', async () => {
    // The settings tab sends the pin with every save. A ruleset its owner
    // stopped sharing must not block renaming the Tournament; the pin itself
    // changes nothing and reads no version.
    await expect(
      events.updateTournament(
        TOURNAMENT_LEGACY,
        { name: 'Sabre open', penaltyRulesetId: PRIVATE_B } as never,
        'u-admin-a',
      ),
    ).resolves.toBeDefined();
    const saved = writesTo(db, 'tournaments').at(-1)?.row as Record<string, unknown>;
    expect(saved).toMatchObject({ name: 'Sabre open', penalty_ruleset_id: PRIVATE_B });
    expect(saved).not.toHaveProperty('penalty_ruleset_version');
  });
});
