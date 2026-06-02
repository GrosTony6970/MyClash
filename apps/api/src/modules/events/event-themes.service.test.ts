import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventThemesService } from './event-themes.service';

const fromMock = vi.fn();
const assertOrgRole = vi.fn();
const uploadLogoOnEvents = vi.fn();

const supabase = {
  service: { from: fromMock },
};

const eventsService = { uploadLogo: uploadLogoOnEvents };

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
    uploadLogoOnEvents.mockResolvedValue({ url: 'https://app.example/storage/v1/logo.png' });
    service = new EventThemesService(
      supabase as never,
      { assertOrgRole } as never,
      eventsService as never,
    );
  });

  // ── Theme upsert ───────────────────────────────────────────────────────────

  it('upserts an existing event theme without writing logo_url to the themes table', async () => {
    // Post-0084: logo_url lives on events, NOT themes. The theme
    // upsert must drop logo_url from its payload and instead PATCH
    // events.logo_url separately.
    const eventsChain = chain({ data: null, error: null });
    const themeChain = chain({ data: { id: 'theme-1' }, error: null });
    fromMock.mockImplementation((table: string) => {
      if (table === 'events') {
        // First call: getEvent. Second call: update events.logo_url.
        if (eventsChain.maybeSingle.mock.calls.length === 0) {
          return chain({
            data: { id: 'event-1', organization_id: 'org-1', logo_url: null },
            error: null,
          });
        }
        return eventsChain;
      }
      return themeChain;
    });

    await service.upsertTheme(
      'event-1',
      { heroImageUrl: 'https://example.com/hero.jpg', logoUrl: 'https://example.com/logo.png' },
      'user-1',
    );

    expect(assertOrgRole).toHaveBeenCalledWith('org-1', 'user-1', 'admin');
    // themes update must NOT carry logo_url — that column is gone (0084).
    // It also must NOT carry the retired color / font / custom_css fields
    // (0086): per-event color overrides are deprecated in favour of the
    // unified MyClash design.
    expect(themeChain.update).toHaveBeenCalledTimes(1);
    const calls = themeChain.update.mock.calls as unknown as Array<[Record<string, unknown>]>;
    const themeUpdatePayload = calls[0]![0];
    expect(themeUpdatePayload).not.toHaveProperty('logo_url');
    expect(themeUpdatePayload).not.toHaveProperty('primary_color');
    expect(themeUpdatePayload).not.toHaveProperty('secondary_color');
    expect(themeUpdatePayload).not.toHaveProperty('accent_color');
    expect(themeUpdatePayload).not.toHaveProperty('font_display');
    expect(themeUpdatePayload).not.toHaveProperty('font_body');
    expect(themeUpdatePayload).not.toHaveProperty('custom_css');
    expect(themeUpdatePayload['hero_image_url']).toBe('https://example.com/hero.jpg');
  });

  // ── Logo upload (shim) ─────────────────────────────────────────────────────

  it('uploadLogo delegates to EventsService so events.logo_url is the writer of record', async () => {
    const result = await service.uploadLogo(
      'event-1',
      { buffer: Buffer.from('png'), filename: 'logo.png', mimetype: 'image/png' },
      'user-1',
    );

    expect(uploadLogoOnEvents).toHaveBeenCalledWith(
      'event-1',
      'user-1',
      expect.objectContaining({ filename: 'logo.png', mimetype: 'image/png' }),
    );
    expect(result.url).toBe('https://app.example/storage/v1/logo.png');
  });

  it('uploadLogo propagates ForbiddenException from the canonical EventsService.uploadLogo', async () => {
    uploadLogoOnEvents.mockRejectedValueOnce(new ForbiddenException('not a member'));

    await expect(
      service.uploadLogo(
        'event-1',
        { buffer: Buffer.from('png'), filename: 'logo.png', mimetype: 'image/png' },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
