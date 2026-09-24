/**
 * Who may change the referee skill catalogue (operator rulings 104 and 104b).
 *
 * A BUILT-IN skill (`is_system`, no Event) is shared by every club, so only a
 * platform admin edits it. A custom skill stays with an admin of its Event's
 * club.
 *
 * The drag-reorder of an Event's catalogue moves only that Event's own custom
 * skills. There is no per-Event order: the route writes `sort_order` onto the
 * skill rows themselves. Until 2026-09-25 it wrote onto any id it was sent, so
 * an admin of one club reordered every club's built-ins, and even another
 * club's custom skills; the edit route let anyone change a built-in's text.
 *
 * Driven through the real QualificationsService, org check and platform-role
 * lookup over seeded tables.
 */
import { BadRequestException, ForbiddenException, HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  mockSupabase,
  scopedTo,
  selectsFor,
  writesTo,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { QualificationsService } from './qualifications.service';

const EVENT_A = '11111111-1111-4111-8111-111111111111';
const EVENT_B = '22222222-2222-4222-8222-222222222222';
const PLATFORM_ADMIN = '33333333-3333-4333-8333-333333333333';
const PLATFORM_VIEWER = '44444444-4444-4444-8444-444444444444';
const ADMIN_A = '55555555-5555-4555-8555-555555555555';

const BUILT_IN = { id: 'arbitre_declarant', event_id: null, is_system: true, name: 'Arbitre' };
const CUSTOM_A1 = { id: 'custom-a1', event_id: EVENT_A, is_system: false, name: 'A1' };
const CUSTOM_A2 = { id: 'custom-a2', event_id: EVENT_A, is_system: false, name: 'A2' };
const CUSTOM_B = { id: 'custom-b', event_id: EVENT_B, is_system: false, name: 'B' };

const TABLES: Record<string, TableSeed> = {
  referee_skills: { rows: [BUILT_IN, CUSTOM_A1, CUSTOM_A2, CUSTOM_B] },
  events: {
    rows: [
      { id: EVENT_A, organization_id: 'org-a' },
      { id: EVENT_B, organization_id: 'org-b' },
    ],
  },
  organization_members: { rows: [{ organization_id: 'org-a', user_id: ADMIN_A, role: 'admin' }] },
  platform_roles: {
    rows: [
      { user_id: PLATFORM_ADMIN, role: 'platform_admin' },
      // The tier just below the bar.
      { user_id: PLATFORM_VIEWER, role: 'platform_viewer' },
    ],
  },
};

let db: ReturnType<typeof mockSupabase>;
let skills: QualificationsService;

function build(overrides: Record<string, TableSeed> = {}) {
  db = mockSupabase({ ...TABLES, ...overrides });
  const supabase = { service: db.service };
  skills = new QualificationsService(
    supabase as never,
    new OrganizationsService(supabase as never),
  );
}

beforeEach(() => build());

describe('editing a built-in referee skill (ruling 104)', () => {
  // The fetched skill, then the updated row read back.
  const builtInThenUpdated = [{ data: BUILT_IN }, { data: { ...BUILT_IN, description: 'Lead' } }];

  it('lets a platform admin change its description', async () => {
    build({ referee_skills: builtInThenUpdated });
    await skills.updateCustomSkill(BUILT_IN.id, { description: 'Lead' }, PLATFORM_ADMIN);
    const [write] = writesTo(db, 'referee_skills');
    expect(write?.row).toMatchObject({ description: 'Lead' });
  });

  it.each([
    ["an admin of a club's Event", ADMIN_A],
    ['platform staff below platform admin', PLATFORM_VIEWER],
  ])('refuses %s, writing nothing', async (_label, userId) => {
    build({ referee_skills: builtInThenUpdated });
    await expect(
      skills.updateCustomSkill(BUILT_IN.id, { description: 'Lead' }, userId),
    ).rejects.toThrow(new ForbiddenException('Only a platform admin edits a built-in skill'));
    expect(writesTo(db, 'referee_skills')).toEqual([]);
  });

  it.each([
    ['rename', { name: 'Hacked' }],
    ['recolour', { color: 'red' }],
  ])('refuses even a platform admin to %s it, writing nothing', async (_verb, dto) => {
    build({ referee_skills: builtInThenUpdated });
    await expect(skills.updateCustomSkill(BUILT_IN.id, dto, PLATFORM_ADMIN)).rejects.toThrow(
      new ForbiddenException('System skills cannot be renamed or recoloured'),
    );
    expect(writesTo(db, 'referee_skills')).toEqual([]);
  });

  it("still lets an admin of the Event's club edit its own custom skill", async () => {
    build({ referee_skills: [{ data: CUSTOM_A1 }, { data: { ...CUSTOM_A1, name: 'A1 bis' } }] });
    await skills.updateCustomSkill(CUSTOM_A1.id, { name: 'A1 bis' }, ADMIN_A);
    expect(writesTo(db, 'referee_skills')).toHaveLength(1);
  });
});

describe("reordering an Event's referee skills (ruling 104b)", () => {
  it("moves this Event's own custom skills, and nothing else", async () => {
    await skills.reorderSkills(EVENT_A, [CUSTOM_A2.id, CUSTOM_A1.id], ADMIN_A);
    const writes = writesTo(db, 'referee_skills');
    expect(
      writes.map((w) => [scopedTo(w, 'id'), (w.row as { sort_order: number }).sort_order]),
    ).toEqual([
      [CUSTOM_A2.id, 0],
      [CUSTOM_A1.id, 1],
    ]);
  });

  it.each([
    ['a built-in skill', BUILT_IN.id],
    ["another Event's custom skill", CUSTOM_B.id],
    ['an unknown skill', 'no-such-skill'],
  ])('refuses a list holding %s, writing nothing', async (_label, strangerId) => {
    await expect(
      skills.reorderSkills(EVENT_A, [CUSTOM_A1.id, strangerId, CUSTOM_A2.id], ADMIN_A),
    ).rejects.toThrow(BadRequestException);
    expect(writesTo(db, 'referee_skills')).toEqual([]);
  });

  it('reads only the id and Event of each skill it is asked to move', async () => {
    await skills.reorderSkills(EVENT_A, [CUSTOM_A1.id], ADMIN_A);
    expect(selectsFor(db.from, 'referee_skills')).toEqual(['id, event_id']);
  });

  it('fails a failed read of the skills loudly (5xx), writing nothing', async () => {
    build({ referee_skills: { data: null, error: { message: 'boom' } } });
    const call = skills.reorderSkills(EVENT_A, [CUSTOM_A1.id], ADMIN_A);
    await expect(call).rejects.toThrow('referee skills read failed: boom');
    await expect(call).rejects.not.toBeInstanceOf(HttpException);
    expect(writesTo(db, 'referee_skills')).toEqual([]);
  });
});
