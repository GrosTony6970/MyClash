/**
 * Ruling 345: an auth server that gives no answer does not turn a signed-in organiser into nobody.
 *
 * Claire signed in at 09:30. At 10:00 the auth server answers nothing, or "too many requests".
 * Fifteen doors asked it alone (`anon.auth.getUser`) and read that as "nobody is signed in": every
 * one refused her with a 401 until it came back. They now ask `SupabaseService.getAuthUser`, as the
 * rest of the API does: the auth server's word when it answers, else the login's own signature.
 *
 * Each case enters at the door with a REAL `SupabaseService` over a `fetch` that fails, and reads
 * the account the door handed on. A login the auth server refuses is still nobody.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIProvidersController } from '../../modules/ai-providers/ai-providers.controller';
import { AIDashboardController } from '../../modules/ai-usage/ai-dashboard.controller';
import { AIUsageController } from '../../modules/ai-usage/ai-usage.controller';
import { ExportsController } from '../../modules/exports/exports.controller';
import { GeneratedContentController } from '../../modules/generated-content/generated-content.controller';
import { MeAIController } from '../../modules/generated-content/me-ai.controller';
import { BroadcastNotificationsController } from '../../modules/notifications/broadcast-notifications.controller';
import { OrganizerAIAssistantController } from '../../modules/organizer-ai-assistant/organizer-ai-assistant.controller';
import { OrganizerChatController } from '../../modules/organizer-chat/organizer-chat.controller';
import { PenaltiesController } from '../../modules/penalties/penalties.controller';
import { PersonEmailChangeService } from '../../modules/persons/person-email-change.service';
import { PrivacyController } from '../../modules/persons/privacy.controller';
import { PhasesController } from '../../modules/phases/phases.controller';
import { StaffController } from '../../modules/staff/staff.controller';
import { SupabaseService } from '../../modules/supabase/supabase.service';
import { TournamentQueryController } from '../../modules/tournament-query/tournament-query.controller';
import { apiSourceFiles } from '../testing/supabase-query-scan';

const SECRET = 'test-supabase-jwt-secret-at-least-32-characters-long';
const CLAIRE = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';
const ROW = { id: ID, organization_id: ID, new_email: 'new@example.com', expires_at: 'later' };

const values: Record<string, string> = {
  SUPABASE_URL: 'https://app.myclash.fr',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  SUPABASE_JWT_SECRET: SECRET,
  SUPABASE_AUTH_INTERNAL_URL: 'http://supabase-auth:9999',
};
const config = { get: (key: string) => values[key], getOrThrow: (key: string) => values[key] };

/** Every argument a door handed to a service, a role check or a database filter. */
let handedOn: unknown[] = [];

/** A service stand-in: every method records what it was given and answers a row. */
const service = () =>
  new Proxy(
    {},
    {
      get: (_target, name) =>
        name === 'then'
          ? undefined
          : (...args: unknown[]) => {
              handedOn.push(...args);
              return Promise.resolve(ROW);
            },
    },
  ) as never;

/** A database read or write that records its filters and answers one row. */
function rowChain(): unknown {
  const chain: unknown = new Proxy(
    {},
    {
      get: (_target, name) =>
        name === 'then'
          ? (resolve: (answer: unknown) => void) => resolve({ data: ROW, error: null })
          : (...args: unknown[]) => {
              handedOn.push(...args);
              return chain;
            },
    },
  );
  return chain;
}

function supabaseOverSilentAuth(): SupabaseService {
  const supabase = new SupabaseService(config as never);
  vi.spyOn(supabase.service, 'from').mockImplementation(() => rowChain() as never);
  return supabase;
}

const login = (claims: object = {}) =>
  jwt.sign({ sub: CLAIRE, email: 'claire@example.com', ...claims }, SECRET, { expiresIn: '1h' });
const request = (token: string) =>
  ({ headers: {}, cookies: { 'sb-access-token': token } }) as never;

type Door = (supabase: SupabaseService, req: never) => Promise<unknown>;

const DOORS: Array<[string, Door]> = [
  [
    'AI usage of an Event',
    (s, req) => new AIUsageController(service(), s, service()).getUsage(ID, req),
  ],
  [
    'AI usage of a club',
    (s, req) => new AIDashboardController(service(), service(), s, service()).orgUsage(ID, req),
  ],
  [
    'AI settings of a club',
    (s, req) => new AIProvidersController(service(), s, service()).getSettings(ID, req),
  ],
  ['her own AI insight', (s, req) => new MeAIController(service(), service(), s).getInsight(req)],
  [
    'generated content',
    (s, req) => new GeneratedContentController(service(), s).generate('recap', ID, req),
  ],
  [
    'a broadcast notice',
    (s, req) =>
      new BroadcastNotificationsController(service(), s).sendEventBroadcast(ID, {} as never, req),
  ],
  [
    'a Tournament question',
    (s, req) => new TournamentQueryController(service(), s).estimate(ID, {} as never, req),
  ],
  [
    'an Event export',
    (s, req) =>
      new ExportsController(service(), s, service(), service()).hemaRatingsZip(ID, req, service()),
  ],
  [
    'the AI setup assistant',
    (s, req) => new OrganizerAIAssistantController(service(), s).create(ID, {} as never, req),
  ],
  [
    'the organiser chat',
    (s, req) => new OrganizerChatController(service(), s).createConversation(ID, {} as never, req),
  ],
  [
    'a Pool',
    (s, req) => new PhasesController(service(), s, service()).renamePool(ID, { name: 'A' }, req),
  ],
  [
    'the PIN staff accounts',
    (s, req) => new StaffController(service(), s, service()).listAccounts(ID, req),
  ],
  [
    'a penalty ruleset',
    (s, req) => new PenaltiesController(service(), s, service(), service()).listVersions(ID, req),
  ],
  [
    'her privacy choices',
    (s, req) => new PrivacyController(service(), s, service()).getPrivacy(req),
  ],
  [
    'her email change',
    (s, req) => new PersonEmailChangeService(s, service(), config as never).cancelEmailChange(req),
  ],
];

const SILENCES: Array<[string, () => Promise<Response>]> = [
  ['gives no answer', () => Promise.reject(new Error('ECONNREFUSED'))],
  ['answers "too many requests"', async () => new Response('{}', { status: 429 })],
  ['answers a server error', async () => new Response('{}', { status: 503 })],
];

describe.each(SILENCES)('an auth server that %s', (_silence, answer) => {
  beforeEach(() => {
    handedOn = [];
    vi.stubGlobal('fetch', vi.fn(answer));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(DOORS)('%s: the door reads Claire from her login', async (_door, enter) => {
    const outcome = await enter(supabaseOverSilentAuth(), request(login())).catch(
      (thrown: unknown) => thrown,
    );

    expect(outcome).not.toBeInstanceOf(UnauthorizedException);
    expect(handedOn).toContain(CLAIRE);
  });

  it.each(DOORS)('%s: a login past its hour is still nobody', async (_door, enter) => {
    const expired = jwt.sign({ sub: CLAIRE, email: 'claire@example.com' }, SECRET, {
      expiresIn: -10,
    });

    await enter(supabaseOverSilentAuth(), request(expired)).catch((thrown: unknown) => thrown);

    expect(handedOn).not.toContain(CLAIRE);
  });
});

describe('an auth server that refuses the login', () => {
  beforeEach(() => {
    handedOn = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"msg":"revoked"}', { status: 401 })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(DOORS)('%s: Claire is nobody, whatever her login says', async (_door, enter) => {
    await enter(supabaseOverSilentAuth(), request(login())).catch((thrown: unknown) => thrown);

    expect(handedOn).not.toContain(CLAIRE);
  });
});

describe('who is calling', () => {
  // A new door that asks `anon.auth.getUser` is the sixteenth: it goes through
  // `request-user.ts`, or asks `SupabaseService.getAuthUser` itself. This reads the call's
  // text only: `PlatformRoleGuard` asks the auth server alone with a `fetch` of its own.
  it('no source file of the API calls `auth.getUser`', () => {
    const files = apiSourceFiles(path.resolve(__dirname, '../..'));
    const alone = files.filter((file) => /auth\s*\.\s*getUser\(/u.test(readFileSync(file, 'utf8')));

    expect(files.length).toBeGreaterThan(600);
    expect(alone).toEqual([]);
  });
});
