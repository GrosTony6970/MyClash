import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClubsService } from './clubs.service';

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock } };

type ChainResult = { data?: unknown; error?: { message: string } | null; count?: number | null };

function makeChain(result: ChainResult = { data: null, error: null }) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    ilike: vi.fn(),
    or: vi.fn(),
    order: vi.fn(),
    is: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  };
  for (const key of ['select', 'eq', 'ilike', 'or', 'order', 'is', 'insert', 'update', 'delete']) {
    chain[key as keyof typeof chain].mockReturnValue(chain);
  }
  return chain;
}

function makeAwaitableChain(result: ChainResult = { data: null, error: null }) {
  const promise = Promise.resolve(result);
  const chain = Object.assign(promise, {
    select: vi.fn(),
    eq: vi.fn(),
    ilike: vi.fn(),
    or: vi.fn(),
    order: vi.fn(),
    is: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  });
  for (const key of ['select', 'eq', 'ilike', 'or', 'order', 'is', 'insert', 'update', 'delete']) {
    (chain as unknown as Record<string, unknown>)[key] = vi.fn().mockReturnValue(chain);
  }
  return chain;
}

describe('ClubsService', () => {
  let service: ClubsService;

  beforeEach(() => {
    vi.clearAllMocks();
    fromMock.mockReturnValue(makeAwaitableChain({ data: [], error: null }));
    service = new ClubsService(mockSupabase as never);
  });

  it('excludes archived clubs from normal list queries', async () => {
    const chain = makeAwaitableChain({ data: [], error: null });
    fromMock.mockReturnValue(chain);

    await service.list({});

    expect(chain.is).toHaveBeenCalledWith('archived_at', null);
  });

  it('safe-deletes an unused club', async () => {
    const countChains = [
      makeAwaitableChain({ count: 0, error: null }),
      makeAwaitableChain({ count: 0, error: null }),
      makeAwaitableChain({ count: 0, error: null }),
    ];
    const deleteChain = makeAwaitableChain({ data: null, error: null });
    fromMock
      .mockReturnValueOnce(countChains[0])
      .mockReturnValueOnce(countChains[1])
      .mockReturnValueOnce(countChains[2])
      .mockReturnValueOnce(deleteChain);

    await expect(service.deleteClub('club-1', 'safe')).resolves.toEqual({
      deleted: true,
      mode: 'safe',
      cleanupApplied: false,
      archived: false,
    });
    expect(deleteChain.delete).toHaveBeenCalled();
    expect(deleteChain.eq).toHaveBeenCalledWith('id', 'club-1');
  });

  it('safe delete refuses clubs with app references and returns blockers', async () => {
    fromMock
      .mockReturnValueOnce(makeAwaitableChain({ count: 2, error: null }))
      .mockReturnValueOnce(makeAwaitableChain({ count: 1, error: null }))
      .mockReturnValueOnce(makeAwaitableChain({ count: 0, error: null }));

    await expect(service.deleteClub('club-1', 'safe')).rejects.toMatchObject({
      response: expect.objectContaining({
        blockers: expect.objectContaining({ globalPersons: 2, eventPersons: 1 }),
      }),
    });
  });

  it('archives a club instead of deleting it', async () => {
    const archiveChain = makeChain({
      data: { id: 'club-1', archived_at: '2026-05-17T00:00:00.000Z' },
      error: null,
    });
    fromMock.mockReturnValue(archiveChain);

    await expect(service.deleteClub('club-1', 'archive')).resolves.toEqual({
      deleted: false,
      mode: 'archive',
      cleanupApplied: false,
      archived: true,
    });
    expect(archiveChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ archived_at: expect.any(String) }),
    );
  });

  it('cleanup delete clears supported club references before deleting the club', async () => {
    const cleanupGlobal = makeAwaitableChain({ data: null, error: null });
    const cleanupPersons = makeAwaitableChain({ data: null, error: null });
    const cleanupFighterClubs = makeAwaitableChain({ data: null, error: null });
    const deleteChain = makeAwaitableChain({ data: null, error: null });
    fromMock
      .mockReturnValueOnce(cleanupGlobal)
      .mockReturnValueOnce(cleanupPersons)
      .mockReturnValueOnce(cleanupFighterClubs)
      .mockReturnValueOnce(deleteChain);

    await service.deleteClub('club-1', 'cleanup');

    expect(cleanupGlobal.update).toHaveBeenCalledWith({ club_id: null });
    expect(cleanupPersons.update).toHaveBeenCalledWith({ club_id: null });
    expect(cleanupFighterClubs.delete).toHaveBeenCalled();
    expect(deleteChain.delete).toHaveBeenCalled();
  });

  it('rejects unknown delete modes', async () => {
    await expect(service.deleteClub('club-1', 'invalid' as never)).rejects.toThrow(
      BadRequestException,
    );
  });
});
