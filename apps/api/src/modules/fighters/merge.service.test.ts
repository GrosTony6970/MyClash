import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FighterMergeService } from './merge.service';

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock } };

function makeChain(result: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.update.mockReturnValue(chain);
  chain.insert.mockResolvedValue(result);
  return chain;
}

describe('FighterMergeService', () => {
  let service: FighterMergeService;

  beforeEach(() => {
    vi.clearAllMocks();
    fromMock.mockReturnValue(makeChain({ data: null, error: null }));
    service = new FighterMergeService(mockSupabase as never);
  });

  it('rejects merging a fighter into itself', async () => {
    await expect(
      service.merge({ sourceId: 'fighter-1', targetId: 'fighter-1' }, 'actor-user'),
    ).rejects.toThrow(BadRequestException);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('rejects missing source or target fighter', async () => {
    const sourceChain = makeChain({ data: null, error: null });
    sourceChain.maybeSingle.mockResolvedValue({ data: null, error: null });
    const targetChain = makeChain({ data: null, error: null });
    targetChain.maybeSingle.mockResolvedValue({ data: { id: 'target' }, error: null });
    fromMock.mockReturnValueOnce(sourceChain).mockReturnValueOnce(targetChain);

    await expect(
      service.merge({ sourceId: 'source', targetId: 'target' }, 'actor'),
    ).rejects.toThrow(NotFoundException);
  });

  it('moves references, fills blank target fields, soft-deletes source, and audits merge', async () => {
    const source = {
      id: 'source',
      slug: 'source-fighter',
      display_name: 'Source Fighter',
      photo_url: 'https://cdn/source.jpg',
      hema_ratings_id: '123',
      bio: 'source bio',
      country_code: 'FR',
      gender_category: 'open',
      merged_into_fighter_id: null,
      deleted_at: null,
    };
    const target = {
      id: 'target',
      slug: 'target-fighter',
      display_name: 'Target Fighter',
      photo_url: null,
      hema_ratings_id: null,
      bio: null,
      country_code: 'BE',
      gender_category: null,
      merged_into_fighter_id: null,
      deleted_at: null,
    };

    const sourceChain = makeChain({ data: null, error: null });
    sourceChain.maybeSingle.mockResolvedValue({ data: source, error: null });
    const targetChain = makeChain({ data: null, error: null });
    targetChain.maybeSingle.mockResolvedValue({ data: target, error: null });
    const personsSelect = makeChain({ data: [{ id: 'person-1' }], error: null });
    personsSelect.select.mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: [{ id: 'person-1' }], error: null }),
    });
    const registrationsSelect = makeChain({ data: [{ id: 'registration-1' }], error: null });
    registrationsSelect.select.mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: [{ id: 'registration-1' }], error: null }),
    });
    const instructorsSelect = makeChain({ data: [{ id: 'instructor-1' }], error: null });
    instructorsSelect.select.mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: [{ id: 'instructor-1' }], error: null }),
    });
    const fighterUpdate = makeChain({ data: null, error: null });
    const personsUpdate = makeChain({ data: null, error: null });
    const registrationsUpdate = makeChain({ data: null, error: null });
    const instructorsUpdate = makeChain({ data: null, error: null });
    const auditInsert = makeChain({ data: null, error: null });

    const fighterChains = [sourceChain, targetChain];
    fromMock.mockImplementation((table: string) => {
      if (table === 'fighters') return fighterChains.shift() ?? fighterUpdate;
      if (table === 'persons')
        return personsSelect.select.mock.calls.length ? personsUpdate : personsSelect;
      if (table === 'registrations') {
        return registrationsSelect.select.mock.calls.length
          ? registrationsUpdate
          : registrationsSelect;
      }
      if (table === 'workshop_instructors') {
        return instructorsSelect.select.mock.calls.length ? instructorsUpdate : instructorsSelect;
      }
      if (table === 'audit_log') return auditInsert;
      return makeChain({ data: null, error: null });
    });

    const result = await service.merge(
      { sourceId: 'source', targetId: 'target', reason: 'duplicate registration' },
      'actor-user',
    );

    expect(result).toEqual({
      merged: true,
      sourceId: 'source',
      targetId: 'target',
      moved: { persons: 1, registrations: 1, workshopInstructors: 1 },
    });
    const fighterUpdateCalls = fighterUpdate.update.mock.calls;
    expect(auditInsert.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'fighter.merge',
        payload_json: expect.objectContaining({
          moved: {
            personIds: ['person-1'],
            registrationIds: ['registration-1'],
            workshopInstructorIds: ['instructor-1'],
          },
          reason: 'duplicate registration',
        }),
      }),
    );
    expect(personsUpdate.update).toHaveBeenCalledWith({ global_fighter_id: 'target' });
    expect(registrationsUpdate.update).toHaveBeenCalledWith({ fighter_id: 'target' });
    expect(instructorsUpdate.update).toHaveBeenCalledWith({ fighter_id: 'target' });
    expect(fighterUpdateCalls).toContainEqual([
      expect.objectContaining({
        merged_into_fighter_id: 'target',
        merge_reverted_at: null,
      }),
    ]);
    expect(auditInsert.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_user_id: 'actor-user',
        action: 'fighter.merge',
        entity_type: 'fighter',
        entity_id: 'source',
        payload_json: expect.objectContaining({
          moved: {
            personIds: ['person-1'],
            registrationIds: ['registration-1'],
            workshopInstructorIds: ['instructor-1'],
          },
          reason: 'duplicate registration',
        }),
      }),
    );
  });

  it('reverts a merge from audit payload within 30 days', async () => {
    const auditChain = makeChain({ data: null, error: null });
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'audit-1',
        action: 'fighter.merge',
        entity_id: 'source',
        created_at: new Date().toISOString(),
        payload_json: {
          source: { id: 'source' },
          target: { id: 'target' },
          moved: {
            personIds: ['person-1'],
            registrationIds: ['registration-1'],
            workshopInstructorIds: ['instructor-1'],
          },
        },
      },
      error: null,
    });
    auditChain.select.mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle }) });
    const personsUpdate = makeChain({ data: null, error: null });
    const registrationsUpdate = makeChain({ data: null, error: null });
    const instructorsUpdate = makeChain({ data: null, error: null });
    const sourceUpdate = makeChain({ data: null, error: null });
    const auditInsert = makeChain({ data: null, error: null });

    fromMock.mockImplementation((table: string) => {
      if (table === 'audit_log')
        return auditChain.select.mock.calls.length ? auditInsert : auditChain;
      if (table === 'persons') return personsUpdate;
      if (table === 'registrations') return registrationsUpdate;
      if (table === 'workshop_instructors') return instructorsUpdate;
      if (table === 'fighters') return sourceUpdate;
      return makeChain({ data: null, error: null });
    });

    await service.revertMerge('audit-1', 'actor-user');

    expect(personsUpdate.update).toHaveBeenCalledWith({ global_fighter_id: 'source' });
    expect(registrationsUpdate.update).toHaveBeenCalledWith({ fighter_id: 'source' });
    expect(instructorsUpdate.update).toHaveBeenCalledWith({ fighter_id: 'source' });
    expect(sourceUpdate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        merged_into_fighter_id: null,
        merged_at: null,
        deleted_at: null,
      }),
    );
    expect(auditInsert.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_user_id: 'actor-user',
        action: 'fighter.merge_revert',
        entity_id: 'source',
      }),
    );
  });

  it('rejects merge reverts after 30 days', async () => {
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const auditChain = makeChain({ data: null, error: null });
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'audit-1',
        action: 'fighter.merge',
        entity_id: 'source',
        created_at: oldDate,
        payload_json: { source: { id: 'source' }, target: { id: 'target' }, moved: {} },
      },
      error: null,
    });
    auditChain.select.mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle }) });
    fromMock.mockImplementation((table: string) =>
      table === 'audit_log' ? auditChain : makeChain({ data: null, error: null }),
    );

    await expect(service.revertMerge('audit-1', 'actor-user')).rejects.toThrow(BadRequestException);
  });
});
