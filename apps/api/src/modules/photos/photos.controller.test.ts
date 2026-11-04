import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import { PhotoDeviceService, PHOTO_DEVICE_COOKIE } from './photo-device';
import { PhotoLinkService } from './photo-link.service';
import { photoToken, photoTokenMatches } from './photo-token';
import { PhotosController } from './photos.controller';

const DEVICE_SECRET = 'test-photo-device-secret-at-least-32-characters';
const TOKEN_SECRET = 'test-photo-token-secret-at-least-32-characters';
const EVENT = '6f9619ff-8b86-4011-b42d-00c04fc964ff';

const devices = new PhotoDeviceService({ getOrThrow: () => DEVICE_SECRET } as never);

function controller() {
  const upload = { upload: vi.fn(async () => ({ id: 'p1', status: 'approved' as const })) };
  const links = { read: vi.fn(), rotate: vi.fn() };
  const ctl = new PhotosController(
    upload as never,
    devices,
    links as never,
    { get: () => 'production' } as never,
    {} as never,
  );
  return { ctl, upload };
}

const reply = () => ({ setCookie: vi.fn() });
const req = (cookies: Record<string, string> = {}, headers: Record<string, string> = {}) =>
  ({ cookies, headers }) as never;

describe('POST events/:eventId/photos', () => {
  it('gives a phone with no cookie a signed device cookie, and counts it under that id', async () => {
    const { ctl, upload } = controller();
    const r = reply();
    await ctl.upload(EVENT, req({}, { 'x-photo-token': 'tok' }), r as never);

    expect(r.setCookie).toHaveBeenCalledOnce();
    const [name, token, options] = r.setCookie.mock.calls[0]!;
    expect(name).toBe(PHOTO_DEVICE_COOKIE);
    expect(options).toMatchObject({ httpOnly: true, sameSite: 'lax', secure: true, path: '/' });
    const { deviceId } = devices.deviceOf(token);
    expect(upload.upload).toHaveBeenCalledWith(EVENT, 'tok', deviceId, expect.anything());
  });

  it('keeps the cookie of a phone it already knows', async () => {
    const { ctl, upload } = controller();
    const known = '2b1e8a6c-0d4f-4c3e-9a7b-5f6e7d8c9b0a';
    const r = reply();
    await ctl.upload(EVENT, req({ [PHOTO_DEVICE_COOKIE]: devices.sign(known).token }), r as never);

    expect(r.setCookie).not.toHaveBeenCalled();
    expect(upload.upload).toHaveBeenCalledWith(EVENT, undefined, known, expect.anything());
  });
});

describe('PhotoLinkService', () => {
  const event = { id: EVENT, organization_id: 'org-1', photo_token_version: 4 };

  function links(allowed = true) {
    const supabase = mockSupabase({ events: { data: event, error: null } });
    const orgs = {
      assertOrgRole: vi.fn(async () => {
        if (!allowed) throw new ForbiddenException();
      }),
    };
    const service = new PhotoLinkService(
      supabase as never,
      orgs as never,
      { getOrThrow: () => TOKEN_SECRET } as never,
    );
    return { service, supabase, orgs };
  }

  it('hands an organiser the current token', async () => {
    const { service, orgs } = links();
    expect(await service.read(EVENT, 'user-1')).toEqual({
      token: photoToken(TOKEN_SECRET, EVENT, 4),
      version: 4,
    });
    expect(orgs.assertOrgRole).toHaveBeenCalledWith('org-1', 'user-1', 'admin');
  });

  it('refuses anyone below organiser', async () => {
    const { service } = links(false);
    await expect(service.read(EVENT, 'user-2')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.rotate(EVENT, 'user-2')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('retires the old link on rotation', async () => {
    const { service, supabase } = links();
    const next = await service.rotate(EVENT, 'user-1');

    expect(next).toEqual({ token: photoToken(TOKEN_SECRET, EVENT, 5), version: 5 });
    expect(writesTo(supabase, 'events').map((w) => w.row)).toEqual([{ photo_token_version: 5 }]);
    expect(photoTokenMatches(TOKEN_SECRET, EVENT, 5, photoToken(TOKEN_SECRET, EVENT, 4))).toBe(
      false,
    );
  });

  it('refuses before writing when the caller may not rotate', async () => {
    const { service, supabase } = links(false);
    await service.rotate(EVENT, 'user-2').catch(() => undefined);
    expect(writesTo(supabase, 'events')).toEqual([]);
  });
});
