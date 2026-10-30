/**
 * Each upload route reads its file under its own limit (operator ruling, 2026-10-30), and over it
 * answers its own 413. One cell per route, on the real controller: the request's reader records
 * the options it was given and finds the file too large, as @fastify/multipart does past
 * `fileSize`. The sizes and sentences are written out here, not imported, so a limit changed in
 * code turns its cell red.
 *
 * The edge tests (`http-edge.http.test.ts`, case 11) run the reader on the real plugin.
 */
import 'reflect-metadata';
import { PayloadTooLargeException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { BackupUploadsService } from '../modules/admin/backup-uploads.service';
import { BackupsAdminController } from '../modules/admin/backups.controller';
import { ClubsController } from '../modules/clubs/clubs.controller';
import { EventsController } from '../modules/events/events.controller';
import { ExportsController } from '../modules/exports/exports.controller';
import {
  FightersController,
  GlobalPersonsController,
} from '../modules/fighters/fighters.controller';
import { LeaguesController } from '../modules/leagues/leagues.controller';
import { OrganizationsController } from '../modules/organizations/organizations.controller';
import { PersonsController } from '../modules/persons/persons.controller';
import { WorkshopsController } from '../modules/workshops/workshops.controller';
import { FILE_TOO_LARGE_CODE } from './read-upload';
import { mockSupabase } from './testing/supabase-chain';
import {
  anyService,
  authAs,
  EVENT,
  ORG,
  tooLargeUpload,
  type UploadRequest,
} from './testing/upload-request';

const MIB = 1024 * 1024;
const LOGO_10 = 'Logo upload exceeds the 10 MB size limit.';
const UPLOAD_ID = '00000000-0000-4000-8000-000000000000';

type Door = (req: never) => Promise<unknown>;

const any = anyService;
const orgsPass = { assertAnyOrgRole: async () => undefined, assertOrgRole: async () => undefined };
const rosterDb = mockSupabase({ events: { rows: [{ id: EVENT, organization_id: ORG }] } });

const events = () => new EventsController(any(), authAs(), any(), any(), any(), any());
const persons = () =>
  new PersonsController(any(), authAs(rosterDb.service), any(), orgsPass as never);
const exportsDoor = () =>
  new ExportsController(any(), authAs(mockSupabase({}).service), any(), orgsPass as never);

/** [route, the limit it reads under, its sentence, which reader, the call]. */
const ROUTES: Array<[string, number, string, 'file' | 'parts', Door]> = [
  [
    'PUT admin/backups/uploads/:uploadId/chunks',
    16 * MIB,
    'A backup upload chunk exceeds 16 MiB.',
    'file',
    (req) =>
      new BackupsAdminController(any(), new BackupUploadsService()).sendChunk(
        UPLOAD_ID,
        { offset: '0' },
        req,
      ),
  ],
  [
    'POST clubs/:id/logo',
    10 * MIB,
    LOGO_10,
    'file',
    (req) => new ClubsController(any()).uploadLogo(ORG, req),
  ],
  [
    'POST events/:id/logo',
    10 * MIB,
    LOGO_10,
    'file',
    (req) => events().uploadEventLogo(EVENT, req),
  ],
  [
    'POST events/:id/hero',
    10 * MIB,
    'Hero upload exceeds the 10 MB size limit.',
    'file',
    (req) => events().uploadEventHero(EVENT, req),
  ],
  [
    'POST tournaments/:id/logo',
    10 * MIB,
    LOGO_10,
    'file',
    (req) => events().uploadTournamentLogo(EVENT, req),
  ],
  [
    'POST fighters/me/photo',
    15 * MIB,
    'Photo upload exceeds the 15 MB size limit.',
    'file',
    (req) => new FightersController(any(), any(), authAs()).uploadMyPhoto(req),
  ],
  [
    'POST global-persons/import/preview',
    10 * MIB,
    'Import file exceeds the 10 MB size limit.',
    'file',
    (req) => new GlobalPersonsController(any(), authAs(), any()).previewGlobalPersonsImport(req),
  ],
  [
    'POST admin/leagues/:leagueId/logo',
    10 * MIB,
    LOGO_10,
    'file',
    (req) => new LeaguesController(any(), authAs()).uploadLogo(ORG, req),
  ],
  [
    'POST organizations/:id/logo',
    10 * MIB,
    LOGO_10,
    'file',
    (req) => new OrganizationsController(any(), authAs()).uploadLogo(ORG, req),
  ],
  [
    'POST workshops/:id/logo',
    15 * MIB,
    'Logo upload exceeds the 15 MB size limit.',
    'file',
    (req) =>
      new WorkshopsController(any(), any(), authAs(), any(), any(), any()).uploadLogo(ORG, req),
  ],
  [
    'POST archive/restore-preview',
    25 * MIB,
    'Archive upload exceeds the 25 MB size limit.',
    'file',
    (req) => exportsDoor().restorePreview(req),
  ],
  [
    'POST archive/restore',
    25 * MIB,
    'Archive upload exceeds the 25 MB size limit.',
    'file',
    (req) => exportsDoor().restoreArchive(req, {} as never),
  ],
  [
    'POST events/:eventId/persons/import/preview',
    10 * MIB,
    'Roster import file exceeds the 10 MB size limit.',
    'parts',
    (req) => persons().previewImport(EVENT, req),
  ],
  [
    'POST events/:eventId/persons/import',
    10 * MIB,
    'Roster import file exceeds the 10 MB size limit.',
    'parts',
    (req) => persons().importCsv(EVENT, req),
  ],
];

describe('each upload route reads under its own limit', () => {
  it('names all fourteen routes', () => {
    expect(new Set(ROUTES.map(([route]) => route)).size).toBe(14);
  });

  it.each(ROUTES)(
    '%s: %i bytes, then its own 413',
    async (_route, bytes, sentence, reader, door) => {
      const upload: UploadRequest = tooLargeUpload();
      const refusal = await door(upload.req).catch((err: unknown) => err);

      expect(refusal).toBeInstanceOf(PayloadTooLargeException);
      expect((refusal as PayloadTooLargeException).getResponse()).toEqual({
        message: sentence,
        code: FILE_TOO_LARGE_CODE,
        maxBytes: bytes,
      });
      expect(upload[reader]).toHaveBeenCalledTimes(1);
      expect(upload[reader].mock.calls[0]?.[0]).toEqual({
        limits: { fileSize: bytes, files: 1, parts: 8 },
      });
    },
  );
});
