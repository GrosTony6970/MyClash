/**
 * Five upload routes refuse a caller who is not signed in before they read the file. They took
 * such a caller's id as "anonymous" and read the whole file under the route's limit; only the
 * service said no, after the read. Each now answers 401 and never asks the request for its file.
 *
 * The archive routes run their own check first (`restore-preview-access.test.ts`); the others
 * refuse first too, in a guard or in the handler.
 */
import 'reflect-metadata';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { photoDoor } from '../modules/photos/testing/photo-door';
import { describe, expect, it } from 'vitest';
import { EventsController } from '../modules/events/events.controller';
import { OrganizationsController } from '../modules/organizations/organizations.controller';
import { WorkshopsController } from '../modules/workshops/workshops.controller';
import { anyService, authAs, EVENT, ORG, tooLargeUpload } from './testing/upload-request';

type Door = (req: never) => Promise<unknown>;

const any = anyService;
const events = () => new EventsController(any(), authAs(), any(), any(), any(), any());

const ROUTES: Array<[string, Door]> = [
  ['POST events/:id/logo', (req) => events().uploadEventLogo(EVENT, req)],
  ['POST events/:id/hero', (req) => events().uploadEventHero(EVENT, req)],
  ['POST tournaments/:id/logo', (req) => events().uploadTournamentLogo(EVENT, req)],
  [
    'POST organizations/:id/logo',
    (req) => new OrganizationsController(any(), authAs()).uploadLogo(ORG, req),
  ],
  [
    'POST workshops/:id/logo',
    (req) =>
      new WorkshopsController(any(), any(), authAs(), any(), any(), any()).uploadLogo(ORG, req),
  ],
];

describe('an upload route refuses a signed-out caller before it reads', () => {
  it.each(ROUTES)('%s: 401, and the file is never asked for', async (_route, door) => {
    const upload = tooLargeUpload(null);
    await expect(door(upload.req)).rejects.toThrow(UnauthorizedException);
    expect(upload.file).not.toHaveBeenCalled();
  });
});

/**
 * The photo route takes no account (operator ruling Q1, 2026-11-04): its door is the QR link's
 * token, so a wrong one is its refusal before the read. Every other refusal before the read is
 * pinned in `photo-upload.service.test.ts`.
 */
describe('the anonymous photo route refuses a wrong QR link before it reads', () => {
  it('POST events/:eventId/photos: 403 photo_link_invalid, and the file is never asked for', async () => {
    const upload = tooLargeUpload(null);
    const refusal = await photoDoor(EVENT, { token: 'not-the-link' })(upload.req).catch(
      (err: unknown) => err,
    );
    expect(refusal).toBeInstanceOf(ForbiddenException);
    expect((refusal as ForbiddenException).getResponse()).toMatchObject({
      code: 'photo_link_invalid',
    });
    expect(upload.file).not.toHaveBeenCalled();
    expect(upload.parts).not.toHaveBeenCalled();
  });
});
