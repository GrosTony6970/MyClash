/**
 * qualifications.service.test.ts — T-906 / T-903
 *
 * Tests for referee skills catalog methods:
 *   ✓ listEventSkills returns system skills + event's custom skills (excludes other events')
 *   ✓ createCustomSkill creates with given color and returns new row
 *   ✓ updateCustomSkill refuses to edit a system skill (throws ForbiddenException)
 *   ✓ deleteCustomSkill refuses when active qualifications reference the skill
 *
 * Task 3 additions:
 *   ✓ updateAvailability upserts when row is missing
 *   ✓ updateAvailability updates existing row preserving unset fields
 *   ✓ listEventReferees returns merged qualifications + assignments + availability
 *   ✓ ensureEventReferee sets global_persons.is_referee = 'true' when profile exists
 *   ✓ updateAvailability propagates ForbiddenException on auth failure
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BadRequestException,
  ForbiddenException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { QualificationsService } from './qualifications.service';

// ── Mock helpers ──────────────────────────────────────────────────────────────

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock } };
const mockOrganizations = { assertOrgRole: vi.fn().mockResolvedValue(undefined) };

function makeChain(result: unknown) {
  const chain = {
    select: vi.fn() as ReturnType<typeof vi.fn>,
    eq: vi.fn() as ReturnType<typeof vi.fn>,
    or: vi.fn() as ReturnType<typeof vi.fn>,
    is: vi.fn() as ReturnType<typeof vi.fn>,
    limit: vi.fn() as ReturnType<typeof vi.fn>,
    order: vi.fn() as ReturnType<typeof vi.fn>,
    insert: vi.fn() as ReturnType<typeof vi.fn>,
    update: vi.fn() as ReturnType<typeof vi.fn>,
    upsert: vi.fn() as ReturnType<typeof vi.fn>,
    delete: vi.fn() as ReturnType<typeof vi.fn>,
    in: vi.fn() as ReturnType<typeof vi.fn>,
    not: vi.fn() as ReturnType<typeof vi.fn>,
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  };
  for (const key of [
    'select',
    'eq',
    'or',
    'is',
    'limit',
    'order',
    'insert',
    'update',
    'upsert',
    'delete',
    'in',
    'not',
  ]) {
    chain[key as keyof typeof chain] = vi.fn().mockReturnValue(chain);
  }
  return chain;
}

function makeResolvedChain(result: unknown) {
  // A chain that resolves to result when awaited AND chains methods
  const chain = makeChain(result);
  const awaitable = Object.assign(Promise.resolve(result), chain);
  for (const key of [
    'select',
    'eq',
    'or',
    'is',
    'order',
    'insert',
    'update',
    'upsert',
    'delete',
    'in',
    'not',
  ]) {
    (awaitable as unknown as Record<string, unknown>)[key] = vi.fn().mockReturnValue(awaitable);
  }
  return awaitable;
}

function makeCountChain(count: number) {
  const chain = makeChain({ count, error: null });
  // The count query resolves directly when awaited
  const awaitable = Object.assign(Promise.resolve({ count, error: null }), chain);
  for (const key of ['select', 'eq']) {
    (awaitable as unknown as Record<string, unknown>)[key] = vi.fn().mockReturnValue(awaitable);
  }
  return awaitable;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('QualificationsService — skills catalog', () => {
  let service: QualificationsService;

  beforeEach(() => {
    // resetAllMocks (not clearAllMocks) — clears the mockReturnValueOnce queue
    // so previously-pushed values from earlier tests don't bleed into this one
    // when a test's flow consumes fewer chains than were queued.
    vi.resetAllMocks();
    mockOrganizations.assertOrgRole.mockResolvedValue(undefined);
    service = new QualificationsService(mockSupabase as never, mockOrganizations as never);
  });

  // ── listEventSkills ───────────────────────────────────────────────────────────

  describe('listEventSkills', () => {
    it('returns system skills and the event custom skills', async () => {
      const systemSkill = {
        id: 'arbitre_declarant',
        event_id: null,
        name: 'Arbitre déclarant',
        color: 'blue',
        is_system: true,
        sort_order: 0,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };
      const customSkill = {
        id: 'custom-abc12345-xyz123',
        event_id: 'event-uuid-1',
        name: 'Expert Longsword',
        color: 'green',
        is_system: false,
        sort_order: 0,
        created_at: '2024-01-02T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z',
      };

      const chain = makeChain({ data: [systemSkill, customSkill], error: null });
      // The final .order().order() call must resolve to the result
      chain.order
        .mockReturnValueOnce(chain)
        .mockReturnValueOnce(Promise.resolve({ data: [systemSkill, customSkill], error: null }));
      fromMock.mockReturnValue(chain);

      const result = await service.listEventSkills('event-uuid-1');

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('arbitre_declarant');
      expect(result[0]!.isSystem).toBe(true);
      expect(result[1]!.id).toBe('custom-abc12345-xyz123');
      expect(result[1]!.isSystem).toBe(false);
      expect(result[1]!.eventId).toBe('event-uuid-1');
    });

    it('excludes custom skills from other events', async () => {
      // The query uses .or(`is_system.eq.true,event_id.eq.${eventId}`) which
      // the DB enforces. Here we just verify the or() call receives the correct filter.
      const chain = makeChain({ data: [], error: null });
      chain.order
        .mockReturnValueOnce(chain)
        .mockReturnValueOnce(Promise.resolve({ data: [], error: null }));
      fromMock.mockReturnValue(chain);

      await service.listEventSkills('my-event-id');

      expect(chain.or).toHaveBeenCalledWith('is_system.eq.true,event_id.eq.my-event-id');
    });
  });

  // ── createCustomSkill ─────────────────────────────────────────────────────────

  describe('createCustomSkill', () => {
    it('creates a skill with the given color and returns the new row', async () => {
      const eventRow = { id: 'aaaa-bbbb-cccc-dddd', organization_id: 'org-1' };
      const newSkillRow = {
        id: 'custom-aabbccdd-xyz123',
        event_id: 'aaaa-bbbb-cccc-dddd',
        name: 'Expert Rapier',
        color: 'red',
        is_system: false,
        sort_order: 0,
        created_at: '2024-01-03T00:00:00Z',
        updated_at: '2024-01-03T00:00:00Z',
      };

      const eventChain = makeChain({ data: eventRow, error: null });
      eventChain.maybeSingle.mockResolvedValue({ data: eventRow, error: null });

      const skillChain = makeChain({ data: newSkillRow, error: null });
      skillChain.single.mockResolvedValue({ data: newSkillRow, error: null });

      fromMock
        .mockReturnValueOnce(eventChain) // getEvent
        .mockReturnValueOnce(skillChain); // insert skill

      const result = await service.createCustomSkill(
        'aaaa-bbbb-cccc-dddd',
        { name: 'Expert Rapier', color: 'red' },
        'user-id-1',
      );

      expect(skillChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          event_id: 'aaaa-bbbb-cccc-dddd',
          name: 'Expert Rapier',
          color: 'red',
          is_system: false,
        }),
      );
      expect(result.color).toBe('red');
      expect(result.name).toBe('Expert Rapier');
      expect(result.isSystem).toBe(false);
    });

    it('generates an id with the custom- prefix', async () => {
      const eventRow = { id: 'aabbccdd-0000-0000-0000-000000000000', organization_id: 'org-1' };
      const newSkillRow = {
        id: 'custom-aabbccdd-xx1234',
        event_id: 'aabbccdd-0000-0000-0000-000000000000',
        name: 'Test Skill',
        color: 'slate',
        is_system: false,
        sort_order: 0,
        created_at: '2024-01-03T00:00:00Z',
        updated_at: '2024-01-03T00:00:00Z',
      };

      const eventChain = makeChain({ data: eventRow, error: null });
      eventChain.maybeSingle.mockResolvedValue({ data: eventRow, error: null });

      const skillChain = makeChain({ data: newSkillRow, error: null });
      skillChain.single.mockResolvedValue({ data: newSkillRow, error: null });

      fromMock
        .mockReturnValueOnce(eventChain) // getEvent
        .mockReturnValueOnce(skillChain); // insert skill

      await service.createCustomSkill(
        'aabbccdd-0000-0000-0000-000000000000',
        { name: 'Test Skill', color: 'slate' },
        'user-id-2',
      );

      // The inserted id should start with 'custom-'
      const insertCall = skillChain.insert.mock.calls[0]![0] as { id: string };
      expect(insertCall.id).toMatch(/^custom-/);
    });
  });

  // ── updateCustomSkill ─────────────────────────────────────────────────────────

  describe('updateCustomSkill', () => {
    it('refuses to edit a system skill (throws ForbiddenException)', async () => {
      const systemSkillRow = {
        id: 'arbitre_declarant',
        event_id: null,
        name: 'Arbitre déclarant',
        color: 'blue',
        is_system: true,
        sort_order: 0,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      const chain = makeChain({ data: systemSkillRow, error: null });
      chain.maybeSingle.mockResolvedValue({ data: systemSkillRow, error: null });
      fromMock.mockReturnValue(chain);

      await expect(
        service.updateCustomSkill('arbitre_declarant', { name: 'Hacked Name' }, 'user-id-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('updates a custom skill when it is not system', async () => {
      const customSkillRow = {
        id: 'custom-aabbccdd-zz1234',
        event_id: 'event-1',
        name: 'Old Name',
        color: 'slate',
        is_system: false,
        sort_order: 0,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };
      const updatedRow = { ...customSkillRow, name: 'New Name', color: 'green' };
      const eventRow = { id: 'event-1', organization_id: 'org-1' };

      const fetchChain = makeChain({ data: customSkillRow, error: null });
      fetchChain.maybeSingle.mockResolvedValue({ data: customSkillRow, error: null });

      const eventChain = makeChain({ data: eventRow, error: null });
      eventChain.maybeSingle.mockResolvedValue({ data: eventRow, error: null });

      const updateChain = makeChain({ data: updatedRow, error: null });
      updateChain.single.mockResolvedValue({ data: updatedRow, error: null });

      fromMock
        .mockReturnValueOnce(fetchChain) // fetch skill
        .mockReturnValueOnce(eventChain) // getEvent
        .mockReturnValueOnce(updateChain); // update skill

      const result = await service.updateCustomSkill(
        'custom-aabbccdd-zz1234',
        { name: 'New Name', color: 'green' },
        'user-id-1',
      );

      expect(result.name).toBe('New Name');
      expect(result.color).toBe('green');
    });

    it('throws NotFoundException if skill does not exist', async () => {
      const chain = makeChain({ data: null, error: null });
      chain.maybeSingle.mockResolvedValue({ data: null, error: null });
      fromMock.mockReturnValue(chain);

      await expect(
        service.updateCustomSkill('nonexistent-skill', { name: 'Foo' }, 'user-id-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── deleteCustomSkill ─────────────────────────────────────────────────────────

  describe('deleteCustomSkill', () => {
    it('refuses when active qualifications reference the skill (throws ConflictException)', async () => {
      const customSkillRow = {
        id: 'custom-aabbccdd-zz1234',
        event_id: 'event-1',
        name: 'Expert Longsword',
        color: 'red',
        is_system: false,
        sort_order: 0,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };
      const eventRow = { id: 'event-1', organization_id: 'org-1' };

      const fetchChain = makeChain({ data: customSkillRow, error: null });
      fetchChain.maybeSingle.mockResolvedValue({ data: customSkillRow, error: null });

      const eventChain = makeChain({ data: eventRow, error: null });
      eventChain.maybeSingle.mockResolvedValue({ data: eventRow, error: null });

      const countChain = makeCountChain(3); // 3 active qualifications reference it
      // R4 of the staffing overhaul (migration 0060): deleteCustomSkill now
      // also counts tournament_slot_allowed_skills + event_slot_config_default_skills
      // rows. The active-qualification count alone is enough to trigger the
      // 409, so the slot-reference counts return 0 here.
      const slotTournamentCountChain = makeCountChain(0);
      const slotEventCountChain = makeCountChain(0);

      fromMock
        .mockReturnValueOnce(fetchChain) // fetch skill
        .mockReturnValueOnce(eventChain) // getEvent
        .mockReturnValueOnce(countChain) // count active qualifications
        .mockReturnValueOnce(slotTournamentCountChain) // count tournament slot refs
        .mockReturnValueOnce(slotEventCountChain); // count event-default slot refs

      await expect(
        service.deleteCustomSkill('custom-aabbccdd-zz1234', 'user-id-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses to delete a system skill (throws ForbiddenException)', async () => {
      const systemSkillRow = {
        id: 'arbitre_declarant',
        event_id: null,
        name: 'Arbitre déclarant',
        color: 'blue',
        is_system: true,
        sort_order: 0,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      const fetchChain = makeChain({ data: systemSkillRow, error: null });
      fetchChain.maybeSingle.mockResolvedValue({ data: systemSkillRow, error: null });
      fromMock.mockReturnValue(fetchChain);

      await expect(service.deleteCustomSkill('arbitre_declarant', 'user-id-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('deletes successfully when no active qualifications reference the skill', async () => {
      const customSkillRow = {
        id: 'custom-aabbccdd-zz1234',
        event_id: 'event-1',
        name: 'Expert Longsword',
        color: 'red',
        is_system: false,
        sort_order: 0,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };
      const eventRow = { id: 'event-1', organization_id: 'org-1' };

      const fetchChain = makeChain({ data: customSkillRow, error: null });
      fetchChain.maybeSingle.mockResolvedValue({ data: customSkillRow, error: null });

      const eventChain = makeChain({ data: eventRow, error: null });
      eventChain.maybeSingle.mockResolvedValue({ data: eventRow, error: null });

      const countChain = makeCountChain(0); // no active qualifications
      // R4 of the staffing overhaul: slot-reference counts also queried.
      const slotTournamentCountChain = makeCountChain(0);
      const slotEventCountChain = makeCountChain(0);

      const deleteChain = makeChain({ data: null, error: null });
      deleteChain.eq.mockResolvedValue({ data: null, error: null });

      fromMock
        .mockReturnValueOnce(fetchChain) // fetch skill
        .mockReturnValueOnce(eventChain) // getEvent
        .mockReturnValueOnce(countChain) // count active qualifications
        .mockReturnValueOnce(slotTournamentCountChain) // count tournament slot refs
        .mockReturnValueOnce(slotEventCountChain) // count event-default slot refs
        .mockReturnValueOnce(deleteChain); // delete

      await expect(
        service.deleteCustomSkill('custom-aabbccdd-zz1234', 'user-id-1'),
      ).resolves.toBeUndefined();
    });
  });

  // ── R4: description field + reorder ──────────────────────────────────────────

  describe('updateCustomSkill (R4 description + sortOrder)', () => {
    it('persists a description on a custom skill', async () => {
      const customSkillRow = {
        id: 'custom-aabbccdd-zz1234',
        event_id: 'event-1',
        name: 'Expert Longsword',
        color: 'red',
        is_system: false,
        sort_order: 0,
        description: '',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };
      const eventRow = { id: 'event-1', organization_id: 'org-1' };

      const fetchChain = makeChain({ data: customSkillRow, error: null });
      fetchChain.maybeSingle.mockResolvedValue({ data: customSkillRow, error: null });

      const eventChain = makeChain({ data: eventRow, error: null });
      eventChain.maybeSingle.mockResolvedValue({ data: eventRow, error: null });

      const updatedRow = { ...customSkillRow, description: 'Senior tournament ref' };
      const updateChain = makeChain({ data: updatedRow, error: null });
      updateChain.single.mockResolvedValue({ data: updatedRow, error: null });

      fromMock
        .mockReturnValueOnce(fetchChain)
        .mockReturnValueOnce(eventChain)
        .mockReturnValueOnce(updateChain);

      const result = await service.updateCustomSkill(
        'custom-aabbccdd-zz1234',
        { description: 'Senior tournament ref' },
        'user-id-1',
      );

      expect(result.description).toBe('Senior tournament ref');
      expect(updateChain.update).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'Senior tournament ref' }),
      );
    });

    it('allows editing description + sortOrder on system skills (rename/recolour still blocked)', async () => {
      const systemSkillRow = {
        id: 'arbitre_declarant',
        event_id: null,
        name: 'Arbitre déclarant',
        color: 'blue',
        is_system: true,
        sort_order: 0,
        description: '',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      const fetchChain = makeChain({ data: systemSkillRow, error: null });
      fetchChain.maybeSingle.mockResolvedValue({ data: systemSkillRow, error: null });

      const updatedRow = { ...systemSkillRow, description: 'Lead ref', sort_order: 2 };
      const updateChain = makeChain({ data: updatedRow, error: null });
      updateChain.single.mockResolvedValue({ data: updatedRow, error: null });

      fromMock.mockReturnValueOnce(fetchChain).mockReturnValueOnce(updateChain);

      const result = await service.updateCustomSkill(
        'arbitre_declarant',
        { description: 'Lead ref', sortOrder: 2 },
        'user-id-1',
      );

      expect(result.description).toBe('Lead ref');
      expect(result.sortOrder).toBe(2);

      // Renaming a system skill must still throw.
      fromMock.mockReturnValueOnce(makeChain({ data: systemSkillRow, error: null }));
      await expect(
        service.updateCustomSkill('arbitre_declarant', { name: 'New Name' }, 'user-id-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('reorderSkills (R4)', () => {
    it('writes sort_order = index for each id in the input order', async () => {
      const eventRow = { id: 'event-1', organization_id: 'org-1' };
      const eventChain = makeChain({ data: eventRow, error: null });
      eventChain.maybeSingle.mockResolvedValue({ data: eventRow, error: null });

      // 3 ordered skills → 3 sequential UPDATE chains. Each .eq(...) resolves
      // as a promise (Supabase's `update().eq()` shape).
      const updateChains = [0, 1, 2].map(() => {
        const c = makeChain({ data: null, error: null });
        (c.eq as ReturnType<typeof vi.fn>).mockResolvedValue({ data: null, error: null });
        return c;
      });

      fromMock
        .mockReturnValueOnce(eventChain)
        .mockReturnValueOnce(updateChains[0]!)
        .mockReturnValueOnce(updateChains[1]!)
        .mockReturnValueOnce(updateChains[2]!);

      await service.reorderSkills(
        'event-1',
        ['arbitre_table', 'arbitre_declarant', 'custom-xxxx-yy1111'],
        'user-id-1',
      );

      expect(updateChains[0]!.update).toHaveBeenCalledWith(
        expect.objectContaining({ sort_order: 0 }),
      );
      expect(updateChains[1]!.update).toHaveBeenCalledWith(
        expect.objectContaining({ sort_order: 1 }),
      );
      expect(updateChains[2]!.update).toHaveBeenCalledWith(
        expect.objectContaining({ sort_order: 2 }),
      );
    });
  });

  // ── upsert (role validation) ──────────────────────────────────────────────────

  describe('upsert', () => {
    it('upsertQualification accepts a custom skill ID belonging to this event', async () => {
      const customSkillRow = {
        id: 'custom-aabbccdd-xyz123',
        is_system: false,
        event_id: 'event-1',
      };
      const qualRow = {
        id: 'qual-uuid-1',
        event_id: 'event-1',
        person_id: 'person-uuid-1',
        role: 'custom-aabbccdd-xyz123',
        rating: null,
        active: true,
        created_at: '2024-01-01T00:00:00Z',
      };

      // referee_skills lookup
      const skillChain = makeChain({ data: customSkillRow, error: null });
      skillChain.maybeSingle.mockResolvedValue({ data: customSkillRow, error: null });

      // Check existing active qualification → not found (post-0063: keyed on person_id directly)
      const existingChain = makeChain({ data: null, error: null });
      existingChain.maybeSingle.mockResolvedValue({ data: null, error: null });

      // Count active qualifications → 0
      const countChain = makeCountChain(0);

      // Insert new qualification
      const insertChain = makeChain({ data: qualRow, error: null });
      insertChain.single.mockResolvedValue({ data: qualRow, error: null });

      fromMock
        .mockReturnValueOnce(skillChain) // referee_skills lookup
        .mockReturnValueOnce(existingChain) // check existing qualification
        .mockReturnValueOnce(countChain) // count active qualifications
        .mockReturnValueOnce(insertChain); // insert new qualification

      const result = await service.upsert(
        'event-1',
        'person-uuid-1',
        'custom-aabbccdd-xyz123',
        null,
      );

      expect(result.role).toBe('custom-aabbccdd-xyz123');
      expect(result.active).toBe(true);
    });

    it('upsertQualification rejects a custom skill ID belonging to a different event', async () => {
      const foreignSkillRow = {
        id: 'custom-aabbccdd-xyz123',
        is_system: false,
        event_id: 'other-event', // belongs to a DIFFERENT event
      };

      const skillChain = makeChain({ data: foreignSkillRow, error: null });
      skillChain.maybeSingle.mockResolvedValue({ data: foreignSkillRow, error: null });

      fromMock.mockReturnValueOnce(skillChain);

      await expect(
        service.upsert('event-1', 'person-uuid-1', 'custom-aabbccdd-xyz123', null),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── authorization enforcement ─────────────────────────────────────────────────

  describe('authorization', () => {
    it('createCustomSkill propagates ForbiddenException when user lacks org role', async () => {
      const eventRow = { id: 'event-1', organization_id: 'org-1' };
      const eventChain = makeChain({ data: eventRow, error: null });
      eventChain.maybeSingle.mockResolvedValue({ data: eventRow, error: null });
      fromMock.mockReturnValueOnce(eventChain);

      mockOrganizations.assertOrgRole.mockRejectedValueOnce(
        new ForbiddenException('Requires admin role or higher'),
      );

      await expect(
        service.createCustomSkill(
          'event-1',
          { name: 'Forbidden Skill', color: 'red' },
          'low-priv-user',
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});

// ── Task 3 tests ──────────────────────────────────────────────────────────────

describe('QualificationsService — Task 3: availability + referees list', () => {
  let service: QualificationsService;

  beforeEach(() => {
    // resetAllMocks (not clearAllMocks) — clears the mockReturnValueOnce queue
    // so previously-pushed values from earlier tests don't bleed into this one
    // when a test's flow consumes fewer chains than were queued.
    vi.resetAllMocks();
    mockOrganizations.assertOrgRole.mockResolvedValue(undefined);
    service = new QualificationsService(mockSupabase as never, mockOrganizations as never);
  });

  // ── updateAvailability ────────────────────────────────────────────────────────

  describe('updateAvailability', () => {
    it('inserts a new event_referees row when the row is missing (upsert path)', async () => {
      const eventRow = { id: 'event-1', organization_id: 'org-1' };

      const eventChain = makeChain({ data: eventRow, error: null });
      eventChain.maybeSingle.mockResolvedValue({ data: eventRow, error: null });

      // Check existing row → not found
      const checkChain = makeChain({ data: null, error: null });
      checkChain.maybeSingle.mockResolvedValue({ data: null, error: null });

      // Insert chain
      const insertChain = makeResolvedChain({ data: null, error: null });

      fromMock
        .mockReturnValueOnce(eventChain) // getEvent
        .mockReturnValueOnce(checkChain) // check existing
        .mockReturnValueOnce(insertChain); // insert

      await service.updateAvailability(
        'event-1',
        'person-target',
        { availableAllTournaments: false },
        'user-actor',
      );

      // insert was called with the dto value overriding the default
      const insertCall = (insertChain as unknown as { insert: ReturnType<typeof vi.fn> }).insert;
      expect(insertCall).toHaveBeenCalledWith(
        expect.objectContaining({
          event_id: 'event-1',
          person_id: 'person-target',
          available_all_tournaments: false,
          available_all_event_duration: true, // default preserved
        }),
      );
    });

    it('updates existing row preserving fields not in dto', async () => {
      const eventRow = { id: 'event-1', organization_id: 'org-1' };
      const existingRow = { event_id: 'event-1' };

      const eventChain = makeChain({ data: eventRow, error: null });
      eventChain.maybeSingle.mockResolvedValue({ data: eventRow, error: null });

      const checkChain = makeChain({ data: existingRow, error: null });
      checkChain.maybeSingle.mockResolvedValue({ data: existingRow, error: null });

      // Update chain — resolves on .eq('user_id', ...)
      const updateChain = makeResolvedChain({ data: null, error: null });

      fromMock
        .mockReturnValueOnce(eventChain) // getEvent
        .mockReturnValueOnce(checkChain) // check existing
        .mockReturnValueOnce(updateChain); // update

      await service.updateAvailability(
        'event-1',
        'user-target',
        { availableAllEventDuration: false }, // only one field
        'user-actor',
      );

      const updateCall = (updateChain as unknown as { update: ReturnType<typeof vi.fn> }).update;
      // Only the provided field + updated_at should be in the update payload
      expect(updateCall).toHaveBeenCalledWith(
        expect.objectContaining({
          available_all_event_duration: false,
        }),
      );
      // The missing field should NOT be in the update payload (preserves existing DB value)
      const payload = updateCall.mock.calls[0]![0] as Record<string, unknown>;
      expect(payload).not.toHaveProperty('available_all_tournaments');
    });

    it('propagates ForbiddenException when actor lacks admin role', async () => {
      const eventRow = { id: 'event-1', organization_id: 'org-1' };
      const eventChain = makeChain({ data: eventRow, error: null });
      eventChain.maybeSingle.mockResolvedValue({ data: eventRow, error: null });
      fromMock.mockReturnValueOnce(eventChain);

      mockOrganizations.assertOrgRole.mockRejectedValueOnce(
        new ForbiddenException('Requires admin role or higher'),
      );

      await expect(
        service.updateAvailability('event-1', 'user-target', {}, 'low-priv-user'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── listEventReferees ─────────────────────────────────────────────────────────

  describe('listEventReferees', () => {
    it('returns merged EventRefereeRow with qualifications + availability (no assignments)', async () => {
      const eventRow = { id: 'event-1', organization_id: 'org-1' };

      // event_referees rows (post-0063: person_id only)
      const refRows = [
        {
          person_id: 'gp-a',
          available_all_tournaments: true,
          available_all_event_duration: false,
        },
      ];

      // referee_qualifications rows
      const qualRows = [{ person_id: 'gp-a', role: 'arbitre_declarant', rating: 4 }];

      // global_persons row
      const gpRows = [
        {
          id: 'gp-a',
          claimed_by_user_id: 'user-a',
          given_name: 'Alice',
          family_name: 'Dupont',
          display_name: 'Alice Dupont',
          club_id: null,
        },
      ];

      // For countAssignmentsByReferee: tournaments → empty (no assignments)
      const tournamentsRows: unknown[] = [];

      const eventChain = makeChain({ data: eventRow, error: null });
      eventChain.maybeSingle.mockResolvedValue({ data: eventRow, error: null });

      const refChain = makeResolvedChain({ data: refRows, error: null });
      const qualChain = makeResolvedChain({ data: qualRows, error: null });
      const gpChain = makeResolvedChain({ data: gpRows, error: null });
      // tournaments query — returns empty
      const tournChain = makeResolvedChain({ data: tournamentsRows, error: null });

      fromMock
        .mockReturnValueOnce(eventChain) // getEvent
        .mockReturnValueOnce(refChain) // event_referees
        .mockReturnValueOnce(qualChain) // referee_qualifications
        .mockReturnValueOnce(gpChain) // global_persons
        .mockReturnValueOnce(tournChain); // tournaments (in countAssignmentsByReferee)

      const result = await service.listEventReferees('event-1', 'actor-user');

      expect(result).toHaveLength(1);
      const row = result[0]!;
      expect(row.userId).toBe('user-a');
      expect(row.personId).toBe('gp-a');
      expect(row.displayName).toBe('Alice Dupont');
      expect(row.availableAllTournaments).toBe(true);
      expect(row.availableAllEventDuration).toBe(false);
      expect(row.qualifications).toHaveLength(1);
      expect(row.qualifications[0]).toEqual({ skillId: 'arbitre_declarant', rating: 4 });
      expect(row.assignments).toHaveLength(0);
      expect(row.totalMatchCount).toBe(0);
    });

    it('returns empty array when no event_referees rows exist', async () => {
      const eventRow = { id: 'event-1', organization_id: 'org-1' };

      const eventChain = makeChain({ data: eventRow, error: null });
      eventChain.maybeSingle.mockResolvedValue({ data: eventRow, error: null });

      const refChain = makeResolvedChain({ data: [], error: null });

      fromMock.mockReturnValueOnce(eventChain).mockReturnValueOnce(refChain);

      const result = await service.listEventReferees('event-1', 'actor-user');
      expect(result).toEqual([]);
    });

    it('populates clubLabel when global person has a club_id', async () => {
      const eventRow = { id: 'event-1', organization_id: 'org-1' };

      const refRows = [
        {
          person_id: 'gp-b',
          available_all_tournaments: true,
          available_all_event_duration: true,
        },
      ];

      const qualRows: unknown[] = [];

      const gpRows = [
        {
          id: 'gp-b',
          claimed_by_user_id: 'user-b',
          given_name: 'Bob',
          family_name: 'Martin',
          display_name: 'Bob Martin',
          club_id: 'club-42',
        },
      ];

      // clubs batch lookup
      const clubsRows = [{ id: 'club-42', name: 'Club Épée de Paris' }];

      // tournaments → empty (no assignments)
      const tournamentsRows: unknown[] = [];

      const eventChain = makeChain({ data: eventRow, error: null });
      eventChain.maybeSingle.mockResolvedValue({ data: eventRow, error: null });

      const refChain = makeResolvedChain({ data: refRows, error: null });
      const qualChain = makeResolvedChain({ data: qualRows, error: null });
      const gpChain = makeResolvedChain({ data: gpRows, error: null });
      const clubsChain = makeResolvedChain({ data: clubsRows, error: null });
      const tournChain = makeResolvedChain({ data: tournamentsRows, error: null });

      fromMock
        .mockReturnValueOnce(eventChain) // getEvent
        .mockReturnValueOnce(refChain) // event_referees
        .mockReturnValueOnce(qualChain) // referee_qualifications
        .mockReturnValueOnce(gpChain) // global_persons
        .mockReturnValueOnce(clubsChain) // clubs batch lookup
        .mockReturnValueOnce(tournChain); // tournaments (in countAssignmentsByReferee)

      const result = await service.listEventReferees('event-1', 'actor-user');

      expect(result).toHaveLength(1);
      const row = result[0]!;
      expect(row.clubLabel).toBe('Club Épée de Paris');
    });

    it('leaves clubLabel null when global person has no club_id', async () => {
      const eventRow = { id: 'event-1', organization_id: 'org-1' };

      const refRows = [
        {
          person_id: 'gp-c',
          available_all_tournaments: true,
          available_all_event_duration: true,
        },
      ];

      const qualRows: unknown[] = [];

      const gpRows = [
        {
          id: 'gp-c',
          claimed_by_user_id: 'user-c',
          given_name: 'Carol',
          family_name: 'Lemaire',
          display_name: 'Carol Lemaire',
          club_id: null,
        },
      ];

      const tournamentsRows: unknown[] = [];

      const eventChain = makeChain({ data: eventRow, error: null });
      eventChain.maybeSingle.mockResolvedValue({ data: eventRow, error: null });

      const refChain = makeResolvedChain({ data: refRows, error: null });
      const qualChain = makeResolvedChain({ data: qualRows, error: null });
      const gpChain = makeResolvedChain({ data: gpRows, error: null });
      // No clubs query expected (club_ids is empty)
      const tournChain = makeResolvedChain({ data: tournamentsRows, error: null });

      fromMock
        .mockReturnValueOnce(eventChain)
        .mockReturnValueOnce(refChain)
        .mockReturnValueOnce(qualChain)
        .mockReturnValueOnce(gpChain)
        .mockReturnValueOnce(tournChain);

      const result = await service.listEventReferees('event-1', 'actor-user');

      expect(result).toHaveLength(1);
      expect(result[0]!.clubLabel).toBeNull();
    });
  });

  // ── ensureEventReferee ────────────────────────────────────────────────────────

  describe('ensureEventReferee', () => {
    it('sets global_persons.is_referee = "true" when a claimed profile exists', async () => {
      const eventRow = { id: 'event-1', organization_id: 'org-1' };

      const eventChain = makeChain({ data: eventRow, error: null });
      eventChain.maybeSingle.mockResolvedValue({ data: eventRow, error: null });

      // claimed global_person check — found. is_referee MUST be `null` (not
      // undefined) for the gp update branch to fire — production gates on
      // `claimed.is_referee === null` so pre-existing referee tags survive.
      const claimedData = { id: 'gp-1', is_referee: null };
      const claimedChain = makeChain({ data: claimedData, error: null });
      claimedChain.maybeSingle.mockResolvedValue({ data: claimedData, error: null });

      // event_referees upsert
      const upsertChain = makeResolvedChain({ data: null, error: null });

      // global_persons update
      const gpUpdateChain = makeResolvedChain({ data: null, error: null });

      fromMock
        .mockReturnValueOnce(eventChain) // getEvent
        .mockReturnValueOnce(claimedChain) // claimed global_person check
        .mockReturnValueOnce(upsertChain) // event_referees upsert
        .mockReturnValueOnce(gpUpdateChain); // global_persons update

      await service.ensureEventReferee('event-1', 'user-target', 'actor-admin');

      // Verify global_persons update was called with is_referee = 'true'
      const updateCall = (gpUpdateChain as unknown as { update: ReturnType<typeof vi.fn> }).update;
      expect(updateCall).toHaveBeenCalledWith(expect.objectContaining({ is_referee: 'true' }));
    });

    it('upserts event_referees with default availability flags', async () => {
      const eventRow = { id: 'event-1', organization_id: 'org-1' };

      const eventChain = makeChain({ data: eventRow, error: null });
      eventChain.maybeSingle.mockResolvedValue({ data: eventRow, error: null });

      // global_person existence check — found
      const personChain = makeChain({ data: { id: 'gp-1', is_referee: null }, error: null });
      personChain.maybeSingle.mockResolvedValue({
        data: { id: 'gp-1', is_referee: null },
        error: null,
      });

      const upsertChain = makeResolvedChain({ data: null, error: null });
      const gpUpdateChain = makeResolvedChain({ data: null, error: null });

      fromMock
        .mockReturnValueOnce(eventChain) // getEvent
        .mockReturnValueOnce(personChain) // global_persons existence check
        .mockReturnValueOnce(upsertChain) // event_referees upsert
        .mockReturnValueOnce(gpUpdateChain); // global_persons update

      await service.ensureEventReferee('event-1', 'gp-1', 'actor-admin');

      const upsertCall = (upsertChain as unknown as { upsert: ReturnType<typeof vi.fn> }).upsert;
      expect(upsertCall).toHaveBeenCalledWith(
        expect.objectContaining({
          event_id: 'event-1',
          person_id: 'gp-1',
          available_all_tournaments: true,
          available_all_event_duration: true,
        }),
        expect.objectContaining({ ignoreDuplicates: true }),
      );
    });

    it('rejects when personId does not match a global_person', async () => {
      const eventRow = { id: 'event-1', organization_id: 'org-1' };

      const eventChain = makeChain({ data: eventRow, error: null });
      eventChain.maybeSingle.mockResolvedValue({ data: eventRow, error: null });

      // global_person check — not found
      const personChain = makeChain({ data: null, error: null });
      personChain.maybeSingle.mockResolvedValue({ data: null, error: null });

      fromMock
        .mockReturnValueOnce(eventChain) // getEvent
        .mockReturnValueOnce(personChain); // global_persons existence check → null

      await expect(
        service.ensureEventReferee('event-1', 'nonexistent-person-id', 'actor-admin'),
      ).rejects.toThrow(BadRequestException);
    });

    it('succeeds when personId matches a global_person', async () => {
      const eventRow = { id: 'event-1', organization_id: 'org-1' };

      const eventChain = makeChain({ data: eventRow, error: null });
      eventChain.maybeSingle.mockResolvedValue({ data: eventRow, error: null });

      const personChain = makeChain({ data: { id: 'gp-claimed', is_referee: null }, error: null });
      personChain.maybeSingle.mockResolvedValue({
        data: { id: 'gp-claimed', is_referee: null },
        error: null,
      });

      const upsertChain = makeResolvedChain({ data: null, error: null });
      const gpUpdateChain = makeResolvedChain({ data: null, error: null });

      fromMock
        .mockReturnValueOnce(eventChain) // getEvent
        .mockReturnValueOnce(personChain) // global_persons existence check
        .mockReturnValueOnce(upsertChain) // event_referees upsert
        .mockReturnValueOnce(gpUpdateChain); // global_persons update

      await expect(
        service.ensureEventReferee('event-1', 'gp-claimed', 'actor-admin'),
      ).resolves.toBeUndefined();

      const upsertCall = (upsertChain as unknown as { upsert: ReturnType<typeof vi.fn> }).upsert;
      expect(upsertCall).toHaveBeenCalled();
    });
  });

  // ── countAssignmentsByReferee — dedup invariant ───────────────────────────────

  describe('countAssignmentsByReferee (via listEventReferees)', () => {
    it('dedups (matchId, personId) across referee_assignments match-scope and matches.referee_id', async () => {
      // Scenario:
      //   - 1 tournament "T1", 1 phase "ph1", 1 pool "pool1"
      //   - 1 match "m1" in pool1
      //   - 1 global_person "gp-1"
      //   - referee_assignments: scope_type='match', match_id=m1, person_id=gp-1
      //   - matches.referee_id points to persons row "p1" whose global_person_id=gp-1
      //   Expected: m1 counted ONCE → totalMatchCount = 1

      const eventRow = { id: 'event-1', organization_id: 'org-1' };

      // event_referees: one row keyed on gp-1
      const refRows = [
        { person_id: 'gp-1', available_all_tournaments: true, available_all_event_duration: true },
      ];

      // referee_qualifications: none
      const qualRows: unknown[] = [];

      // global_persons: gp-1 claimed by u1 (claim irrelevant to dedup)
      const gpRows = [
        {
          id: 'gp-1',
          claimed_by_user_id: 'u1',
          given_name: 'User',
          family_name: 'One',
          display_name: 'User One',
          club_id: null,
        },
      ];

      // countAssignmentsByReferee internals:
      const tournamentsRows = [{ id: 't1', name: 'T1' }];
      const phaseRows = [{ id: 'ph1', tournament_id: 't1' }];
      const poolRows = [{ id: 'pool1', phase_id: 'ph1' }];
      // matches — m1 belongs to ph1/pool1, referee_id = p1 (event-scoped persons.id)
      const matchRows = [{ id: 'm1', phase_id: 'ph1', pool_id: 'pool1', referee_id: 'p1' }];
      // persons — event-scoped p1 → global_person_id gp-1
      const personRows = [{ id: 'p1', global_person_id: 'gp-1' }];
      // referee_assignments — match-scope for m1/gp-1
      const assignmentRows = [
        { person_id: 'gp-1', scope_type: 'match', pool_id: null, match_id: 'm1' },
      ];

      const eventChain = makeChain({ data: eventRow, error: null });
      eventChain.maybeSingle.mockResolvedValue({ data: eventRow, error: null });

      const refChain = makeResolvedChain({ data: refRows, error: null });
      const qualChain = makeResolvedChain({ data: qualRows, error: null });
      const gpChain = makeResolvedChain({ data: gpRows, error: null });
      // No clubs query (no club_id)
      const tournChain = makeResolvedChain({ data: tournamentsRows, error: null });
      const phaseChain = makeResolvedChain({ data: phaseRows, error: null });
      const poolChain = makeResolvedChain({ data: poolRows, error: null });
      const matchChain = makeResolvedChain({ data: matchRows, error: null });
      const personChain = makeResolvedChain({ data: personRows, error: null });
      const assignmentChain = makeResolvedChain({ data: assignmentRows, error: null });

      fromMock
        .mockReturnValueOnce(eventChain) // getEvent
        .mockReturnValueOnce(refChain) // event_referees
        .mockReturnValueOnce(qualChain) // referee_qualifications
        .mockReturnValueOnce(gpChain) // global_persons
        // countAssignmentsByReferee:
        .mockReturnValueOnce(tournChain) // tournaments
        .mockReturnValueOnce(phaseChain) // phases
        .mockReturnValueOnce(poolChain) // pools
        .mockReturnValueOnce(matchChain) // matches
        .mockReturnValueOnce(personChain) // persons (for referee_id resolution)
        .mockReturnValueOnce(assignmentChain); // referee_assignments

      const result = await service.listEventReferees('event-1', 'actor-user');

      expect(result).toHaveLength(1);
      const row = result[0]!;
      // m1 must be counted exactly once despite appearing in both sources
      expect(row.totalMatchCount).toBe(1);
      expect(row.assignments).toHaveLength(1);
      expect(row.assignments[0]!.matchCount).toBe(1);
    });
  });
});
