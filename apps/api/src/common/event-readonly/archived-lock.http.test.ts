import { Body, Controller, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupabaseService } from '../../modules/supabase/supabase.service';
import { API_GLOBAL_PREFIX, API_GLOBAL_PREFIX_EXCLUDE } from '../global-prefix';
import { mockSupabase } from '../testing/supabase-chain';
import { AllowOnArchivedEvent } from './allow-on-archived.decorator';
import { EventReadOnlyGuard } from './event-readonly.guard';

/**
 * Real requests through the real router and the lock (rulings 222 and 223).
 *
 * The unit tests hand the resolver a request they built. This one proves what
 * the router really hands a guard: the address as the caller wrote it, which
 * may be percent-encoded, beside the route it matched and the decoded
 * parameters. A lock that reads the first lets `/m%61tches/<id>/…` through.
 */
const ARCHIVED = 'aaba08c8-f692-49ac-ace3-45ce2c58ef8a';
const LIVE = 'bbba08c8-f692-49ac-ace3-45ce2c58ef8b';
const OLD_TOURNAMENT = 'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f';
const LIVE_TOURNAMENT = 'c2d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f';
const OLD_BOUT = 'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e';
const OLD_WORKSHOP = 'd1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f5a';
const UNKNOWN = 'e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b';
const ARCHIVED_WORDING = 'This event is archived and read-only.';

@Controller()
class ProbeController {
  @Patch('tournaments/:id')
  tournament(): { ok: true } {
    return { ok: true };
  }

  @Post('matches/:id/exchanges')
  @HttpCode(HttpStatus.OK)
  exchange(): { ok: true } {
    return { ok: true };
  }

  @Patch('workshops/:id')
  workshop(): { ok: true } {
    return { ok: true };
  }

  @Post('workshops/:id/feedback')
  @HttpCode(HttpStatus.OK)
  @AllowOnArchivedEvent()
  rating(): { ok: true } {
    return { ok: true };
  }

  @Post('events/:eventId/pass')
  @HttpCode(HttpStatus.OK)
  pass(): { ok: true } {
    return { ok: true };
  }

  @Post('referee-assignments')
  @HttpCode(HttpStatus.OK)
  bodyNamesTheEvent(@Body() _body: unknown): { ok: true } {
    return { ok: true };
  }
}

const database = mockSupabase({
  events: {
    rows: [
      { id: ARCHIVED, slug: 'open-2025', status: 'archived' },
      { id: LIVE, slug: 'open-2026', status: 'running' },
    ],
  },
  tournaments: {
    rows: [
      { id: OLD_TOURNAMENT, event_id: ARCHIVED },
      { id: LIVE_TOURNAMENT, event_id: LIVE },
    ],
  },
  matches: { rows: [{ id: OLD_BOUT, phases: { tournaments: { event_id: ARCHIVED } } }] },
  workshops: { rows: [{ id: OLD_WORKSHOP, event_id: ARCHIVED }] },
});

let app: NestFastifyApplication;

async function send(
  method: 'POST' | 'PATCH',
  path: string,
  payload: Record<string, unknown> = {},
): Promise<{ status: number; message: unknown }> {
  const res = await app.inject({ method, url: `/${API_GLOBAL_PREFIX}/${path}`, payload });
  return { status: res.statusCode, message: (res.json() as { message?: unknown }).message };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ProbeController],
    providers: [
      { provide: SupabaseService, useValue: database },
      { provide: APP_GUARD, useClass: EventReadOnlyGuard },
    ],
  }).compile();

  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  // As main.ts: the route the lock reads carries the prefix.
  app.setGlobalPrefix(API_GLOBAL_PREFIX, { exclude: API_GLOBAL_PREFIX_EXCLUDE });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app?.close();
});

describe('the archived-Event lock, over HTTP', () => {
  it('refuses a write to a Tournament of an archived Event, in the lock’s own words', async () => {
    expect(await send('PATCH', `tournaments/${OLD_TOURNAMENT}`)).toEqual({
      status: 403,
      message: ARCHIVED_WORDING,
    });
  });

  it('refuses a write to a Workshop of an archived Event', async () => {
    expect((await send('PATCH', `workshops/${OLD_WORKSHOP}`)).status).toBe(403);
  });

  it('lets the same write through on an Event that is not archived', async () => {
    expect((await send('PATCH', `tournaments/${LIVE_TOURNAMENT}`)).status).toBe(200);
  });

  it('refuses an address with one letter percent-encoded', async () => {
    expect((await send('POST', `m%61tches/${OLD_BOUT}/exchanges`)).status).toBe(403);
    expect((await send('PATCH', `tourn%61ments/${OLD_TOURNAMENT}`)).status).toBe(403);
  });

  it('refuses an address with a character of the id percent-encoded', async () => {
    const encoded = OLD_BOUT.replace('b1', '%621');
    expect((await send('POST', `matches/${encoded}/exchanges`)).status).toBe(403);
  });

  it('keeps a Workshop rating open on an archived Event (ruling 223)', async () => {
    expect((await send('POST', `workshops/${OLD_WORKSHOP}/feedback`)).status).toBe(200);
  });

  it('refuses a write that names the archived Event by its slug', async () => {
    expect((await send('POST', 'events/open-2025/pass')).status).toBe(403);
    expect((await send('POST', 'events/open-2026/pass')).status).toBe(200);
  });

  it('reads the Event of the body, not an address written into the query string', async () => {
    const answer = await send('POST', `referee-assignments?next=/events/${LIVE}`, {
      eventId: ARCHIVED,
    });
    expect(answer.status).toBe(403);
  });

  it('leaves a row it does not know to the handler', async () => {
    expect((await send('PATCH', `tournaments/${UNKNOWN}`)).status).toBe(200);
  });
});
