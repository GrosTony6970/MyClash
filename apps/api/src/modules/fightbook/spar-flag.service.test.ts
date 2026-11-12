import { NotFoundException, type HttpException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lastFunctionParams } from '../../common/testing/migration-function';
import { mockSupabase, type ChainResult } from '../../common/testing/supabase-chain';
import { flagSchema } from './fightbook-after.controller';
import { SparFlagService } from './spar-flag.service';
import { notifySparFlagRaised } from './spar-flag-notice';

vi.mock('./spar-flag-notice', () => ({ notifySparFlagRaised: vi.fn() }));

const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const JULIE = '1c8d4b63-8e6a-4b68-8a66-2c2a4a6d3b12';
const PAUL = '2d9e5c74-9f7b-4c79-9b77-3d3b5b7e4c23';
const REQUEST = '5b000000-0000-4000-8000-00000000000a';
const FLAG = '7f000000-0000-4000-8000-00000000000f';
// Saturday 23 May 2026 in Paris: "We sparred" opens at Friday 22:00Z.
const MARK_FROM = new Date('2026-05-22T22:00:00Z');
const INPUT = { reason: 'equipment', text: 'A cracked mask' } as const;

const row = (over: Record<string, unknown> = {}) => ({
  id: REQUEST,
  asker_global_person_id: MARC,
  receiver_global_person_id: JULIE,
  status: 'agreed',
  spar_day: '2026-05-23',
  zone: 'Europe/Paris',
  expires_at: '2026-05-24T04:00:00+00:00',
  ...over,
});

function setup(options: { spar?: Record<string, unknown> | null; flag?: ChainResult } = {}) {
  const flagAnswer = vi.fn(
    (_args: Record<string, unknown>): ChainResult => options.flag ?? { data: FLAG, error: null },
  );
  const found = options.spar === undefined ? row() : options.spar;
  const supabase = mockSupabase(
    { spar_requests: { data: found, error: null } },
    { fightbook_flag: flagAnswer },
  );
  const service = new SparFlagService(
    supabase as never,
    { sendImmediate: vi.fn() } as never,
    { get: vi.fn((_key: string, fallback: string) => `${fallback}.test`) } as never,
  );
  return { service, supabase };
}

async function codeOf(promise: Promise<unknown>): Promise<[number, string | undefined]> {
  try {
    await promise;
  } catch (e) {
    const err = e as HttpException;
    return [err.getStatus(), (err.getResponse() as { code?: string }).code];
  }
  return [0, undefined];
}

afterEach(() => vi.mocked(notifySparFlagRaised).mockReset());

describe('SparFlagService.raise', () => {
  it('answers 404 to a stranger, and calls no function', async () => {
    const { service, supabase } = setup();
    await expect(service.raise(PAUL, REQUEST, INPUT, MARK_FROM)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('answers 404 to a request that does not exist', async () => {
    const { service, supabase } = setup({ spar: null });
    await expect(service.raise(MARC, REQUEST, INPUT, MARK_FROM)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('answers not_open on a pending spar, before any function call', async () => {
    const { service, supabase } = setup({ spar: row({ status: 'pending' }) });
    expect(await codeOf(service.raise(MARC, REQUEST, INPUT, MARK_FROM))).toEqual([409, 'not_open']);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it.each(['agreed', 'done', 'cancelled'])('sends a flag on a %s spar from markFrom', async (s) => {
    const { service, supabase } = setup({ spar: row({ status: s }) });
    await service.raise(JULIE, REQUEST, INPUT, MARK_FROM);
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });

  it('answers not_open one minute before markFrom', async () => {
    const { service, supabase } = setup({ spar: row({ status: 'cancelled' }) });
    const early = new Date(MARK_FROM.getTime() - 60_000);
    expect(await codeOf(service.raise(MARC, REQUEST, INPUT, early))).toEqual([409, 'not_open']);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('opens a free-date spar at midnight on its own clock, Montreal', async () => {
    const montreal = row({ spar_day: '2026-06-10', zone: 'America/Montreal' });
    const midnight = new Date('2026-06-10T04:00:00Z');
    const early = new Date(midnight.getTime() - 60_000);
    const shut = setup({ spar: montreal });
    expect(await codeOf(shut.service.raise(MARC, REQUEST, INPUT, early))).toEqual([
      409,
      'not_open',
    ]);
    const open = setup({ spar: montreal });
    await open.service.raise(MARC, REQUEST, INPUT, midnight);
    expect(open.supabase.rpc).toHaveBeenCalledTimes(1);
  });

  it('calls fightbook_flag as the caller, on the service clock, with the function’s own keys', async () => {
    const { service, supabase } = setup();
    await service.raise(JULIE, REQUEST, INPUT, MARK_FROM);
    const [name, args] = supabase.rpc.mock.calls[0]!;
    expect(name).toBe('fightbook_flag');
    expect(args).toEqual({
      p_request: REQUEST,
      p_reporter: JULIE,
      p_reason: 'equipment',
      p_body: 'A cracked mask',
      p_now: MARK_FROM.toISOString(),
    });
    expect(Object.keys(args!).sort()).toEqual([...lastFunctionParams('fightbook_flag')].sort());
  });

  it('starts the alert with the new flag id and the domain, and does not wait for it', async () => {
    vi.mocked(notifySparFlagRaised).mockReturnValue(new Promise(() => undefined));
    const { service } = setup();
    await service.raise(MARC, REQUEST, INPUT, MARK_FROM); // resolves though the send never settles
    expect(notifySparFlagRaised).toHaveBeenCalledTimes(1);
    const [deps, flagId] = vi.mocked(notifySparFlagRaised).mock.calls[0]!;
    expect(flagId).toBe(FLAG);
    expect(deps.domain).toBe('myclash.localhost.test');
  });

  it('answers a second tap quietly: null from the function, no second alert', async () => {
    const { service } = setup({ flag: { data: null, error: null } });
    await expect(service.raise(MARC, REQUEST, INPUT, MARK_FROM)).resolves.toBeUndefined();
    expect(notifySparFlagRaised).not.toHaveBeenCalled();
  });

  it('turns the function’s not_open into 409', async () => {
    const { service } = setup({
      flag: { data: null, error: { code: 'P0001', message: 'not_open' } },
    });
    expect(await codeOf(service.raise(MARC, REQUEST, INPUT, MARK_FROM))).toEqual([409, 'not_open']);
    expect(notifySparFlagRaised).not.toHaveBeenCalled();
  });
});

describe('flagSchema', () => {
  const parse = (body: unknown) => flagSchema.safeParse(body);

  it('trims the text and takes one of the four reasons', () => {
    expect(parse({ reason: 'too_hard', text: '  Too rough  ' })).toMatchObject({
      success: true,
      data: { reason: 'too_hard', text: 'Too rough' },
    });
  });

  it('refuses a blank text, 1001 characters, an unknown reason and an extra key', () => {
    expect(parse({ reason: 'other', text: ' \n\t ' }).success).toBe(false);
    expect(parse({ reason: 'other', text: 'x'.repeat(1001) }).success).toBe(false);
    expect(parse({ reason: 'other', text: 'x'.repeat(1000) }).success).toBe(true);
    expect(parse({ reason: 'rude', text: 'x' }).success).toBe(false);
    expect(parse({ reason: 'other', text: 'x', extra: 1 }).success).toBe(false);
  });
});
