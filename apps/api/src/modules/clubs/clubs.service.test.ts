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

  it('removes a club logo: deletes every storage object under the club prefix then nulls logo_url', async () => {
    const lookupChain = makeChain({
      data: {
        id: 'club-1',
        logo_url:
          'https://assets.test/storage/v1/object/public/event-assets/clubs/club-1/logo-1.png',
      },
      error: null,
    });
    const updateChain = makeChain({
      data: { id: 'club-1', logo_url: null },
      error: null,
    });
    fromMock.mockReturnValueOnce(lookupChain).mockReturnValueOnce(updateChain);

    const listMock = vi.fn().mockResolvedValue({
      data: [{ name: 'logo-1.png' }, { name: 'logo-2.webp' }],
      error: null,
    });
    const removeMock = vi.fn().mockResolvedValue({ error: null });
    storageFromMock.mockReturnValue({ list: listMock, remove: removeMock });

    await expect(service.deleteLogo('club-1')).resolves.toEqual({
      id: 'club-1',
      logo_url: null,
    });

    expect(storageFromMock).toHaveBeenCalledWith('event-assets');
    expect(listMock).toHaveBeenCalledWith('clubs/club-1');
    expect(removeMock).toHaveBeenCalledWith([
      'clubs/club-1/logo-1.png',
      'clubs/club-1/logo-2.webp',
    ]);
    expect(updateChain.update).toHaveBeenCalledWith(expect.objectContaining({ logo_url: null }));
  });

  it('removing a logo on a club without one is a no-op (no storage call, no update)', async () => {
    const lookupChain = makeChain({
      data: { id: 'club-1', logo_url: null },
      error: null,
    });
    fromMock.mockReturnValueOnce(lookupChain);

    const listMock = vi.fn();
    const removeMock = vi.fn();
    storageFromMock.mockReturnValue({ list: listMock, remove: removeMock });

    await expect(service.deleteLogo('club-1')).resolves.toEqual({
      id: 'club-1',
      logo_url: null,
    });

    expect(listMock).not.toHaveBeenCalled();
    expect(removeMock).not.toHaveBeenCalled();
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

  // ── Bulk verify / unverify / archive / safe-delete ──────────────────────

  it('bulk-verifies a batch of clubs and writes a single batch audit row', async () => {
    // Each setVerified call: update().eq().select().single() → one chain.
    // Plus one audit_log insert per single-item op + one batch row at the end.
    fromMock.mockImplementation(() => makeChain({ data: { id: 'ok' }, error: null }));

    const result = await service.bulkSetVerified(['club-1', 'club-2', 'club-3'], true, 'actor');

    expect(result).toEqual({ succeeded: 3, failed: 0, errors: [] });
    // 3 single-item updates + 3 single-item audit rows + 1 batch audit row = 7
    const auditCalls = fromMock.mock.calls.filter((args) => args[0] === 'audit_log');
    expect(auditCalls.length).toBe(4);
  });

  it('bulk cleanup-delete clears references and deletes each row, then writes a single batch audit row', async () => {
    // Each `cleanup` deleteClub call: 3 reference-clearing chains
    // (global_persons, persons, fighter_clubs) + 1 deleteClubRow chain.
    // No per-item audit row is written by deleteClub itself in cleanup mode.
    // So for N ids: N * 4 chains + 1 final batch audit row.
    fromMock.mockImplementation(() => makeAwaitableChain({ data: null, error: null }));

    const result = await service.bulkCleanupDelete(['club-1', 'club-2'], 'actor');

    expect(result).toEqual({ succeeded: 2, failed: 0, errors: [] });
    const auditCalls = fromMock.mock.calls.filter((args) => args[0] === 'audit_log');
    expect(auditCalls.length).toBe(1);
    expect(auditCalls[0]?.[0]).toBe('audit_log');
  });

  it('bulk-update rejects when neither city nor countryCode is supplied', async () => {
    await expect(service.bulkUpdate(['club-1', 'club-2'], {} as never, 'actor')).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.bulkUpdate(['club-1'], {} as never, 'actor')).rejects.toThrow(
      'No fields to update',
    );
  });

  it('bulk-update applies only the supplied fields across the batch', async () => {
    // Each update() call: update().eq().select().single() → one chain.
    // Followed by one final audit_log insert for the batch row.
    const updateChain = makeChain({ data: { id: 'ok', city: 'Lyon' }, error: null });
    fromMock.mockReturnValue(updateChain);

    const result = await service.bulkUpdate(
      ['club-1', 'club-2', 'club-3'],
      { ids: ['club-1', 'club-2', 'club-3'], city: 'Lyon' },
      'actor',
    );

    expect(result).toEqual({ succeeded: 3, failed: 0, errors: [] });
    // The patch passed into update() only includes `city`, not `countryCode`.
    expect(updateChain.update).toHaveBeenCalledWith({ city: 'Lyon' });
    expect(updateChain.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ country_code: expect.anything() }),
    );
  });

  it('bulk safe-delete surfaces still-referenced rows as per-row errors and keeps the batch alive', async () => {
    // Sequence per id:
    //   - safe path → 3 countReferences chains (global_persons, persons, fighter_clubs)
    //   - if all zero → one deleteClubRow chain
    //   - then one audit_log insert
    //
    // For id 'club-1': all zeros → safe delete succeeds.
    // For id 'club-2': global_persons returns 2 references → throws → caught as per-row error.
    fromMock
      // club-1 — safe path, no references, delete succeeds, audit logged
      .mockReturnValueOnce(makeAwaitableChain({ count: 0, error: null })) // global_persons
      .mockReturnValueOnce(makeAwaitableChain({ count: 0, error: null })) // persons
      .mockReturnValueOnce(makeAwaitableChain({ count: 0, error: null })) // fighter_clubs
      .mockReturnValueOnce(makeAwaitableChain({ data: null, error: null })) // delete
      .mockReturnValueOnce(makeAwaitableChain({ data: null, error: null })) // audit_log
      // club-2 — still referenced → BadRequestException → caught as error
      .mockReturnValueOnce(makeAwaitableChain({ count: 2, error: null }))
      .mockReturnValueOnce(makeAwaitableChain({ count: 0, error: null }))
      .mockReturnValueOnce(makeAwaitableChain({ count: 0, error: null }))
      // batch audit row at the end
      .mockReturnValueOnce(makeAwaitableChain({ data: null, error: null }));

    const result = await service.bulkSafeDelete(['club-1', 'club-2'], 'actor');

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.id).toBe('club-2');
  });
});
