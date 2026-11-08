import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { IS_PUBLIC_KEY } from '../../common/auth/public.decorator';
import { ANONYMOUS_USER_ID } from '../../common/auth/request-user';
import { ALLOW_ON_ARCHIVED_EVENT_KEY } from '../../common/event-readonly/allow-on-archived.decorator';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import { PUBLIC_LIVE_READ_THROTTLE } from '../../common/throttling/throttle-profiles';
import { PhotoDeviceService, PHOTO_DEVICE_COOKIE } from './photo-device';
import { PhotoLinkService } from './photo-link.service';
import { photoReportBodySchema, publicPhotoQuerySchema } from './photo-public.dto';
import { photoKeepBodySchema, photoQueueQuerySchema } from './photo-queue.dto';
import { photoToken, photoTokenMatches } from './photo-token';
import { PhotosController } from './photos.controller';

const DEVICE_SECRET = 'test-photo-device-secret-at-least-32-characters';
const TOKEN_SECRET = 'test-photo-token-secret-at-least-32-characters';
const EVENT = '6f9619ff-8b86-4011-b42d-00c04fc964ff';
const PHOTO = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
/** The newest report a moderator's screen showed, as the database wrote it. */
const SHOWN = '2026-11-07T12:00:00.123456+00:00';

const devices = new PhotoDeviceService({ getOrThrow: () => DEVICE_SECRET } as never);

function controller() {
  const upload = { upload: vi.fn(async () => ({ id: 'p1', status: 'approved' as const })) };
  const links = { read: vi.fn(), rotate: vi.fn() };
  const moderation = {
    eventForOrganiser: vi.fn(async (eventId: string) => ({ id: eventId, gate: 'organiser' })),
    eventForModerator: vi.fn(async (eventId: string) => ({ id: eventId, gate: 'moderator' })),
    summary: vi.fn(async () => ({})),
    list: vi.fn(async () => ({ photos: [], next: null })),
    approve: vi.fn(async () => ({ id: PHOTO, status: 'approved' })),
    remove: vi.fn(async () => undefined),
    keep: vi.fn(async () => ({ id: PHOTO, kept: true })),
  };
  const publicPhotos = {
    feed: vi.fn(async () => ({ photos: [], next: null })),
    report: vi.fn(async () => ({ reported: true })),
  };
  const downloads = { busy: vi.fn(() => false) };
  // A signed-in organiser: `requireRequestUserId` turns the session cookie into this user.
  const supabase = { getAuthUser: vi.fn(async () => ({ id: 'user-7' })) };
  const ctl = new PhotosController(
    upload as never,
    devices,
    links as never,
    { get: () => 'production' } as never,
    supabase as never,
    moderation as never,
    publicPhotos as never,
    downloads as never,
  );
  return { ctl, upload, moderation, publicPhotos, downloads };
}

/** `@Throttle({ global: … })`'s limit, as `@nestjs/throttler` stores it (as auth.controller.test.ts). */
const THROTTLE_LIMIT = 'THROTTLER:LIMITglobal';
const marked = (key: string, handler: keyof PhotosController): unknown =>
  new Reflector().get(key, PhotosController.prototype[handler] as never);

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
    expect(upload.upload).toHaveBeenCalledWith(
      EVENT,
      { kind: 'phone', token: 'tok', deviceId },
      expect.anything(),
    );
  });

  it('keeps the cookie of a phone it already knows', async () => {
    const { ctl, upload } = controller();
    const known = '2b1e8a6c-0d4f-4c3e-9a7b-5f6e7d8c9b0a';
    const r = reply();
    await ctl.upload(EVENT, req({ [PHOTO_DEVICE_COOKIE]: devices.sign(known).token }), r as never);

    expect(r.setCookie).not.toHaveBeenCalled();
    expect(upload.upload).toHaveBeenCalledWith(
      EVENT,
      { kind: 'phone', token: undefined, deviceId: known },
      expect.anything(),
    );
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

  it("pass the Event of the moderators' gate (club admin or super admin, 491) to each call", async () => {
    const { ctl, moderation } = controller();
    await ctl.summary(EVENT, signedIn());
    await ctl.queue(EVENT, { filter: 'all', before: undefined }, signedIn());
    await ctl.approve(EVENT, PHOTO, signedIn());
    await ctl.remove(EVENT, PHOTO, signedIn());

    expect(moderation.eventForModerator).toHaveBeenCalledTimes(4);
    for (const call of moderation.eventForModerator.mock.calls) {
      expect(call).toEqual([EVENT, 'user-7']);
    }
    expect(moderation.eventForOrganiser).not.toHaveBeenCalled();
    const gated = { id: EVENT, gate: 'moderator' };
    expect(moderation.summary).toHaveBeenCalledWith(gated);
    expect(moderation.list).toHaveBeenCalledWith(gated, 'all', undefined);
    expect(moderation.approve).toHaveBeenCalledWith(gated, PHOTO);
    expect(moderation.remove).toHaveBeenCalledWith(gated, PHOTO);
  });

  it('the summary says whether every zip slot is taken, as the download service counts (497)', async () => {
    const { ctl, moderation, downloads } = controller();
    moderation.summary.mockResolvedValue({ waiting: 3 } as never);
    await expect(ctl.summary(EVENT, signedIn())).resolves.toEqual({
      waiting: 3,
      downloadsBusy: false,
    });
    downloads.busy.mockReturnValue(true);
    await expect(ctl.summary(EVENT, signedIn())).resolves.toEqual({
      waiting: 3,
      downloadsBusy: true,
    });
  });

  it('refuse a caller with no session before asking the service', async () => {
    const { ctl, moderation } = controller();
    await expect(ctl.summary(EVENT, req())).rejects.toThrow('Authentication required');
    await expect(ctl.remove(EVENT, PHOTO, req())).rejects.toThrow('Authentication required');
    expect(moderation.summary).not.toHaveBeenCalled();
    expect(moderation.remove).not.toHaveBeenCalled();
  });

  it('the approve and the delete stay open on an archived Event (ruling 443)', () => {
    const reflector = new Reflector();
    const open = (handler: keyof PhotosController) =>
      reflector.get<boolean>(
        ALLOW_ON_ARCHIVED_EVENT_KEY,
        PhotosController.prototype[handler] as never,
      ) === true;
    expect(open('remove')).toBe(true);
    expect(open('approve')).toBe(true);
    expect(open('rotateLink')).toBe(false);
  });

  it("Keep clears a photo's reports up to the newest shown, behind the moderators' gate, open on an archived Event (447, 457)", async () => {
    const { ctl, moderation } = controller();
    const body = { reportsUpTo: SHOWN };
    await expect(ctl.keep(EVENT, PHOTO, body, signedIn())).resolves.toEqual({
      id: PHOTO,
      kept: true,
    });
    expect(moderation.eventForModerator).toHaveBeenCalledWith(EVENT, 'user-7');
    expect(moderation.keep).toHaveBeenCalledWith({ id: EVENT, gate: 'moderator' }, PHOTO, SHOWN);

    await expect(ctl.keep(EVENT, PHOTO, body, req())).rejects.toThrow('Authentication required');
    expect(marked(ALLOW_ON_ARCHIVED_EVENT_KEY, 'keep')).toBe(true);
  });
});

describe('the public photo routes', () => {
  it('the list reads as the caller, with the query, under the live-read throttle', async () => {
    const { ctl, publicPhotos } = controller();
    await ctl.publicList(EVENT, { tournamentId: PHOTO }, req());

    expect(publicPhotos.feed).toHaveBeenCalledWith(
      EVENT,
      { userId: ANONYMOUS_USER_ID, staff: null },
      { tournamentId: PHOTO },
    );
    expect(marked(IS_PUBLIC_KEY, 'publicList')).toBe(true);
    expect(marked(THROTTLE_LIMIT, 'publicList')).toBe(PUBLIC_LIVE_READ_THROTTLE.global.limit);
  });

  it('a Report from a phone with no cookie gives it one, and counts under that id', async () => {
    const { ctl, publicPhotos } = controller();
    const r = reply();
    await ctl.report(EVENT, PHOTO, { comment: 'this is me' }, req(), r as never);

    expect(r.setCookie).toHaveBeenCalledOnce();
    const [name, token] = r.setCookie.mock.calls[0]!;
    expect(name).toBe(PHOTO_DEVICE_COOKIE);
    const { deviceId } = devices.deviceOf(token);
    expect(publicPhotos.report).toHaveBeenCalledWith(
      EVENT,
      PHOTO,
      deviceId,
      { userId: ANONYMOUS_USER_ID, staff: null },
      'this is me',
    );
  });

  it.each([{}, { comment: null }, { comment: '' }])(
    'a Report with %o carries no comment (ruling 452)',
    async (body) => {
      const { ctl, publicPhotos } = controller();
      // The pipe trims before the handler sees it: '' stands for a comment of spaces.
      await ctl.report(EVENT, PHOTO, body, req(), reply() as never);
      expect(publicPhotos.report).toHaveBeenCalledWith(
        EVENT,
        PHOTO,
        expect.any(String),
        expect.anything(),
        null,
      );
    },
  );

  it('a Report from a known phone keeps its cookie and its id', async () => {
    const { ctl, publicPhotos } = controller();
    const known = '2b1e8a6c-0d4f-4c3e-9a7b-5f6e7d8c9b0a';
    const r = reply();
    await ctl.report(
      EVENT,
      PHOTO,
      {},
      req({ [PHOTO_DEVICE_COOKIE]: devices.sign(known).token }),
      r as never,
    );

    expect(r.setCookie).not.toHaveBeenCalled();
    expect(publicPhotos.report).toHaveBeenCalledWith(EVENT, PHOTO, known, expect.anything(), null);
  });

  it('a Report is public, and open on an archived Event (ruling 447)', () => {
    expect(marked(IS_PUBLIC_KEY, 'report')).toBe(true);
    expect(marked(ALLOW_ON_ARCHIVED_EVENT_KEY, 'report')).toBe(true);
    expect(marked(THROTTLE_LIMIT, 'report')).toBeUndefined();
  });
});

describe('PublicPhotoQueryDto', () => {
  const parse = (query: Record<string, string | undefined>) =>
    publicPhotoQuerySchema.safeParse(query);
  const T = '11111111-1111-4111-8111-111111111111';

  it('takes a cursor as PostgREST writes it, and one filter', () => {
    const before = '2026-11-05T12:00:00.123456+00:00';
    expect(parse({ before, tournamentId: T })).toEqual({
      success: true,
      data: { before, tournamentId: T },
    });
  });

  it('refuses both filters at once, a cursor that is no instant, and an unknown key', () => {
    expect(parse({ tournamentId: T, workshopId: T }).success).toBe(false);
    expect(parse({ before: 'yesterday' }).success).toBe(false);
    expect(parse({ filter: 'all' }).success).toBe(false);
  });
});

describe('PhotoReportBodyDto', () => {
  const parse = (body: unknown) => photoReportBodySchema.safeParse(body);

  it('takes a comment of 200 characters, trimmed, or none', () => {
    expect(parse({ comment: `  ${'x'.repeat(200)}  ` })).toEqual({
      success: true,
      data: { comment: 'x'.repeat(200) },
    });
    expect(parse({}).success).toBe(true);
    expect(parse({ comment: null }).success).toBe(true);
  });

  it('counts characters as a caption does: 200 emoji are taken, 201 are not', () => {
    expect(parse({ comment: '🤺'.repeat(200) }).success).toBe(true);
    expect(parse({ comment: '🤺'.repeat(201) }).success).toBe(false);
  });

  it('refuses a NUL, which Postgres would refuse with a 500', () => {
    expect(parse({ comment: 'this is\u0000 me' }).success).toBe(false);
  });

  it('refuses 201 characters, an unknown key, and no body', () => {
    expect(parse({ comment: 'x'.repeat(201) }).success).toBe(false);
    expect(parse({ reason: 'spam' }).success).toBe(false);
    expect(parse(undefined).success).toBe(false);
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

  it('reads the Reported tab', () => {
    expect(parse({ filter: 'reported' })).toEqual({ success: true, data: { filter: 'reported' } });
  });

  it.each([{ filter: 'bogus' }, { before: 'yesterday' }, { page: '2' }])('refuses %o', (query) => {
    expect(parse(query).success).toBe(false);
  });
});

describe('PhotoKeepBodyDto', () => {
  const parse = (body: unknown) => photoKeepBodySchema.safeParse(body);

  it('takes the newest report time as PostgREST writes it, unchanged', () => {
    expect(parse({ reportsUpTo: SHOWN })).toEqual({ success: true, data: { reportsUpTo: SHOWN } });
  });

  it.each([
    undefined,
    {},
    { reportsUpTo: null },
    { reportsUpTo: 'yesterday' },
    { reportsUpTo: '2026-11-07T12:00:00.123456' },
    { reportsUpTo: SHOWN, all: true },
  ])('refuses %o', (body) => {
    expect(parse(body).success).toBe(false);
  });
});
