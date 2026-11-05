import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { ALLOW_ON_ARCHIVED_EVENT_KEY } from '../../common/event-readonly/allow-on-archived.decorator';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import { PhotoDeviceService, PHOTO_DEVICE_COOKIE } from './photo-device';
import { PhotoLinkService } from './photo-link.service';
import { photoQueueQuerySchema } from './photo-queue.dto';
import { photoToken, photoTokenMatches } from './photo-token';
import { PhotosController } from './photos.controller';

const DEVICE_SECRET = 'test-photo-device-secret-at-least-32-characters';
const TOKEN_SECRET = 'test-photo-token-secret-at-least-32-characters';
const EVENT = '6f9619ff-8b86-4011-b42d-00c04fc964ff';
const PHOTO = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

const devices = new PhotoDeviceService({ getOrThrow: () => DEVICE_SECRET } as never);

function controller() {
  const upload = { upload: vi.fn(async () => ({ id: 'p1', status: 'approved' as const })) };
  const links = { read: vi.fn(), rotate: vi.fn() };
  const moderation = {
    eventForOrganiser: vi.fn(async (eventId: string) => ({ id: eventId, gate: 'organiser' })),
    summary: vi.fn(async () => ({})),
    list: vi.fn(async () => ({ photos: [], next: null })),
    approve: vi.fn(async () => ({ id: PHOTO, status: 'approved' })),
    remove: vi.fn(async () => undefined),
  };
  // A signed-in organiser: `requireRequestUserId` turns the session cookie into this user.
  const supabase = { getAuthUser: vi.fn(async () => ({ id: 'user-7' })) };
  const ctl = new PhotosController(
    upload as never,
    devices,
    links as never,
    { get: () => 'production' } as never,
    supabase as never,
    moderation as never,
  );
  return { ctl, upload, moderation };
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

describe('the moderation routes', () => {
  const signedIn = () => req({ 'sb-access-token': 'session' });

  it('pass the Event of the organiser gate to each call', async () => {
    const { ctl, moderation } = controller();
    await ctl.summary(EVENT, signedIn());
    await ctl.queue(EVENT, { filter: 'all', before: undefined }, signedIn());
    await ctl.approve(EVENT, PHOTO, signedIn());
    await ctl.remove(EVENT, PHOTO, signedIn());

    expect(moderation.eventForOrganiser).toHaveBeenCalledTimes(4);
    for (const call of moderation.eventForOrganiser.mock.calls) {
      expect(call).toEqual([EVENT, 'user-7']);
    }
    const gated = { id: EVENT, gate: 'organiser' };
    expect(moderation.summary).toHaveBeenCalledWith(gated);
    expect(moderation.list).toHaveBeenCalledWith(gated, 'all', undefined);
    expect(moderation.approve).toHaveBeenCalledWith(gated, PHOTO);
    expect(moderation.remove).toHaveBeenCalledWith(gated, PHOTO);
  });

  it('refuse a caller with no session before asking the service', async () => {
    const { ctl, moderation } = controller();
    await expect(ctl.summary(EVENT, req())).rejects.toThrow('Authentication required');
    await expect(ctl.remove(EVENT, PHOTO, req())).rejects.toThrow('Authentication required');
    expect(moderation.summary).not.toHaveBeenCalled();
    expect(moderation.remove).not.toHaveBeenCalled();
  });

  it('only the delete stays open on an archived Event', () => {
    const reflector = new Reflector();
    const open = (handler: keyof PhotosController) =>
      reflector.get<boolean>(
        ALLOW_ON_ARCHIVED_EVENT_KEY,
        PhotosController.prototype[handler] as never,
      ) === true;
    expect(open('remove')).toBe(true);
    expect(open('approve')).toBe(false);
  });
});

describe('PhotoQueueQueryDto', () => {
  const parse = (query: Record<string, string | undefined>) =>
    photoQueueQuerySchema.safeParse(query);

  it('takes the cursor as PostgREST writes it, unchanged', () => {
    const before = '2026-11-05T12:00:00.123456+00:00';
    expect(parse({ filter: 'all', before })).toEqual({
      success: true,
      data: { filter: 'all', before },
    });
  });

  it('reads the Waiting tab by default', () => {
    expect(parse({})).toEqual({ success: true, data: { filter: 'waiting' } });
  });

  it.each([{ filter: 'reported' }, { before: 'yesterday' }, { page: '2' }])(
    'refuses %o',
    (query) => {
      expect(parse(query).success).toBe(false);
    },
  );
});
