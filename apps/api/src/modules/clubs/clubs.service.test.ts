import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClubsService } from './clubs.service';

const fromMock = vi.fn();
const storageFromMock = vi.fn();
const getBucketMock = vi.fn();
const createBucketMock = vi.fn();
const mockSupabase = {
  service: {
    from: fromMock,
    storage: {
      from: storageFromMock,
      getBucket: getBucketMock,
      createBucket: createBucketMock,
    },
  },
};

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
    getBucketMock.mockResolvedValue({ data: { id: 'event-assets' }, error: null });
    createBucketMock.mockResolvedValue({ data: { id: 'event-assets' }, error: null });
    storageFromMock.mockReturnValue({
      upload: vi.fn().mockResolvedValue({ error: null }),
      getPublicUrl: vi.fn().mockReturnValue({
        data: { publicUrl: 'https://assets.test/clubs/club-1/logo.png' },
      }),
    });
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

  it('uploads a valid club logo and stores its public URL', async () => {
    const lookupChain = makeChain({ data: { id: 'club-1' }, error: null });
    const updateChain = makeChain({
      data: { id: 'club-1', logo_url: 'https://assets.test/clubs/club-1/logo.png' },
      error: null,
    });
    fromMock.mockReturnValueOnce(lookupChain).mockReturnValueOnce(updateChain);
    const uploadMock = vi.fn().mockResolvedValue({ error: null });
    const getPublicUrlMock = vi.fn().mockReturnValue({
      data: { publicUrl: 'https://assets.test/clubs/club-1/logo.png' },
    });
    storageFromMock.mockReturnValue({
      upload: uploadMock,
      getPublicUrl: getPublicUrlMock,
    });

    await expect(
      service.uploadLogo('club-1', {
        buffer: Buffer.from('png'),
        filename: 'Club Logo.png',
        mimetype: 'image/png',
      }),
    ).resolves.toEqual({ url: 'https://assets.test/clubs/club-1/logo.png' });

    expect(storageFromMock).toHaveBeenCalledWith('event-assets');
    expect(uploadMock).toHaveBeenCalledWith(
      expect.stringMatching(/^clubs\/club-1\/logo-\d+-club-logo\.png$/u),
      Buffer.from('png'),
      expect.objectContaining({ contentType: 'image/png', upsert: true }),
    );
    expect(updateChain.update).toHaveBeenCalledWith({
      logo_url: 'https://assets.test/clubs/club-1/logo.png',
    });
  });

  it('rejects oversized club logos', async () => {
    fromMock.mockReturnValueOnce(makeChain({ data: { id: 'club-1' }, error: null }));

    await expect(
      service.uploadLogo('club-1', {
        buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
        filename: 'logo.png',
        mimetype: 'image/png',
      }),
    ).rejects.toThrow('10 MB');
  });

  it('rejects unsupported club logo file types', async () => {
    fromMock.mockReturnValueOnce(makeChain({ data: { id: 'club-1' }, error: null }));

    await expect(
      service.uploadLogo('club-1', {
        buffer: Buffer.from('<svg />'),
        filename: 'logo.svg',
        mimetype: 'image/svg+xml',
      }),
    ).rejects.toThrow('PNG, JPEG, or WebP');
  });

  it('creates organizer-submitted clubs as unverified', async () => {
    const createChain = makeChain({
      data: { id: 'club-1', name: 'New Club', unverified: 'true' },
      error: null,
    });
    fromMock.mockReturnValue(createChain);

    await expect(service.createUnverified({ name: 'New Club' })).resolves.toMatchObject({
      id: 'club-1',
      unverified: 'true',
    });
    expect(createChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'New Club', unverified: 'true' }),
    );
  });

  it('approves a club review request by verifying the proposed club', async () => {
    const requestChain = makeChain({
      data: { id: 'request-1', proposed_club_id: 'club-1', status: 'pending' },
      error: null,
    });
    const clubUpdateChain = makeAwaitableChain({ data: null, error: null });
    const requestUpdateChain = makeChain({
      data: { id: 'request-1', status: 'approved' },
      error: null,
    });
    fromMock
      .mockReturnValueOnce(requestChain)
      .mockReturnValueOnce(clubUpdateChain)
      .mockReturnValueOnce(requestUpdateChain);

    await expect(service.approveReviewRequest('request-1')).resolves.toMatchObject({
      status: 'approved',
    });
    expect(clubUpdateChain.update).toHaveBeenCalledWith({
      unverified: 'false',
      archived_at: null,
    });
    expect(requestUpdateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'approved' }),
    );
  });

  it('links a review request to an existing club and archives the duplicate', async () => {
    const requestChain = makeChain({
      data: { id: 'request-1', proposed_club_id: 'club-new', status: 'pending' },
      error: null,
    });
    const existingClubChain = makeChain({ data: { id: 'club-existing' }, error: null });
    const updateGlobal = makeAwaitableChain({ data: null, error: null });
    const updatePersons = makeAwaitableChain({ data: null, error: null });
    const updateFighterClubs = makeAwaitableChain({ data: null, error: null });
    const archiveDuplicate = makeAwaitableChain({ data: null, error: null });
    const requestUpdateChain = makeChain({
      data: { id: 'request-1', status: 'linked', linked_existing_club_id: 'club-existing' },
      error: null,
    });
    fromMock
      .mockReturnValueOnce(requestChain)
      .mockReturnValueOnce(existingClubChain)
      .mockReturnValueOnce(updateGlobal)
      .mockReturnValueOnce(updatePersons)
      .mockReturnValueOnce(updateFighterClubs)
      .mockReturnValueOnce(archiveDuplicate)
      .mockReturnValueOnce(requestUpdateChain);

    await expect(service.linkReviewRequest('request-1', 'club-existing')).resolves.toMatchObject({
      status: 'linked',
      linked_existing_club_id: 'club-existing',
    });
    expect(updateGlobal.update).toHaveBeenCalledWith({ club_id: 'club-existing' });
    expect(updatePersons.update).toHaveBeenCalledWith({ club_id: 'club-existing' });
    expect(updateFighterClubs.update).toHaveBeenCalledWith({ club_id: 'club-existing' });
    expect(archiveDuplicate.update).toHaveBeenCalledWith({
      archived_at: expect.any(String),
    });
  });
});
