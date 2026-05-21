/**
 * qualifications.service.test.ts — T-906
 *
 * Tests for referee skills catalog methods:
 *   ✓ listEventSkills returns system skills + event's custom skills (excludes other events')
 *   ✓ createCustomSkill creates with given color and returns new row
 *   ✓ updateCustomSkill refuses to edit a system skill (throws ForbiddenException)
 *   ✓ deleteCustomSkill refuses when active qualifications reference the skill
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException, ConflictException, NotFoundException } from '@nestjs/common';
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
    order: vi.fn() as ReturnType<typeof vi.fn>,
    insert: vi.fn() as ReturnType<typeof vi.fn>,
    update: vi.fn() as ReturnType<typeof vi.fn>,
    delete: vi.fn() as ReturnType<typeof vi.fn>,
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  };
  for (const key of ['select', 'eq', 'or', 'order', 'insert', 'update', 'delete']) {
    chain[key as keyof typeof chain] = vi.fn().mockReturnValue(chain);
  }
  return chain;
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
    vi.clearAllMocks();
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

      fromMock
        .mockReturnValueOnce(fetchChain) // fetch skill
        .mockReturnValueOnce(eventChain) // getEvent
        .mockReturnValueOnce(countChain); // count active qualifications

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

      const deleteChain = makeChain({ data: null, error: null });
      deleteChain.eq.mockResolvedValue({ data: null, error: null });

      fromMock
        .mockReturnValueOnce(fetchChain) // fetch skill
        .mockReturnValueOnce(eventChain) // getEvent
        .mockReturnValueOnce(countChain) // count active qualifications
        .mockReturnValueOnce(deleteChain); // delete

      await expect(
        service.deleteCustomSkill('custom-aabbccdd-zz1234', 'user-id-1'),
      ).resolves.toBeUndefined();
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
