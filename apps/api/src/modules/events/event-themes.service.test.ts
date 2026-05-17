import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventThemesService } from './event-themes.service';

const fromMock = vi.fn();
const assertOrgRole = vi.fn();
const upload = vi.fn();
const getPublicUrl = vi.fn();
const createBucket = vi.fn();
const getBucket = vi.fn();

const supabase = {
  service: {
    from: fromMock,
    storage: {
      from: vi.fn(() => ({ upload, getPublicUrl })),
      getBucket,
      createBucket,
    },
  },
};

function chain(result: unknown) {
  const state = {
    select: vi.fn(() => state),
    eq: vi.fn(() => state),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
    insert: vi.fn(() => state),
    update: vi.fn(() => state),
  };
  return state;
}

describe('EventThemesService', () => {
  let service: EventThemesService;

  beforeEach(() => {
    vi.clearAllMocks();
    getBucket.mockResolvedValue({ data: { id: 'event-assets' }, error: null });
    getPublicUrl.mockReturnValue({
      data: { publicUrl: 'https://app.example/storage/v1/logo.png' },
    });
    upload.mockResolvedValue({ data: { path: 'events/event-1/theme/logo.png' }, error: null });
    service = new EventThemesService(supabase as never, { assertOrgRole } as never);
  });

  it('upserts an existing event theme after organizer admin authorization', async () => {
    const themeChain = chain({ data: { id: 'theme-1' }, error: null });
    fromMock.mockImplementation((table: string) => {
      if (table === 'events') {
        return chain({ data: { id: 'event-1', organization_id: 'org-1' }, error: null });
      }
      return themeChain;
    });

    await service.upsertTheme(
      'event-1',
      { primaryColor: '#dc2626', logoUrl: 'https://example.com/logo.png' },
      'user-1',
    );

    expect(assertOrgRole).toHaveBeenCalledWith('org-1', 'user-1', 'admin');
    expect(themeChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        primary_color: '#dc2626',
        logo_url: 'https://example.com/logo.png',
      }),
    );
  });

  it('rejects logo uploads over 10 MB', async () => {
    fromMock.mockImplementation(() =>
      chain({ data: { id: 'event-1', organization_id: 'org-1' }, error: null }),
    );

    await expect(
      service.uploadLogo(
        'event-1',
        {
          buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
          filename: 'logo.png',
          mimetype: 'image/png',
        },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(upload).not.toHaveBeenCalled();
  });

  it('rejects unsupported logo file types', async () => {
    fromMock.mockImplementation(() =>
      chain({ data: { id: 'event-1', organization_id: 'org-1' }, error: null }),
    );

    await expect(
      service.uploadLogo(
        'event-1',
        { buffer: Buffer.from('svg'), filename: 'logo.svg', mimetype: 'image/svg+xml' },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(upload).not.toHaveBeenCalled();
  });

  it('uploads valid logos to event-scoped storage after authorization', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'events') {
        return chain({ data: { id: 'event-1', organization_id: 'org-1' }, error: null });
      }
      return chain({ data: null, error: null });
    });

    const result = await service.uploadLogo(
      'event-1',
      { buffer: Buffer.from('png'), filename: 'logo.png', mimetype: 'image/png' },
      'user-1',
    );

    expect(assertOrgRole).toHaveBeenCalledWith('org-1', 'user-1', 'admin');
    expect(upload).toHaveBeenCalledWith(
      expect.stringMatching(/^events\/event-1\/theme\/logo-/u),
      Buffer.from('png'),
      expect.objectContaining({ contentType: 'image/png', upsert: true }),
    );
    expect(result.url).toBe('https://app.example/storage/v1/logo.png');
  });

  it('propagates real organization membership failures', async () => {
    assertOrgRole.mockRejectedValueOnce(new ForbiddenException('not a member'));
    fromMock.mockImplementation(() =>
      chain({ data: { id: 'event-1', organization_id: 'org-1' }, error: null }),
    );

    await expect(
      service.uploadLogo(
        'event-1',
        { buffer: Buffer.from('png'), filename: 'logo.png', mimetype: 'image/png' },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
