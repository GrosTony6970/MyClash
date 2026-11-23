import type { HttpException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import { AdminFeatureFlagsService } from '../admin/admin-feature-flags.service';
import { SparAfterService } from './spar-after.service';

// "We sparred" at a demo Event months ahead, with the platform clock frozen on its day (operator,
// 2026-11-23): the real flags service hands the simulated instant, and the window opens on it.
const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const JULIE = '1c8d4b63-8e6a-4b68-8a66-2c2a4a6d3b12';
const REQUEST = '5b000000-0000-4000-8000-00000000000a';
const REAL = new Date('2026-11-23T10:00:00.000Z');
const FROZEN = {
  simulatedNowIso: '2027-05-23T11:31:00.000Z',
  anchorRealIso: '2026-11-23T09:00:00.000Z',
  mode: 'frozen',
};

function setup(simulation: boolean) {
  const flags = new AdminFeatureFlagsService(
    mockSupabase({
      feature_flags: {
        rows: [{ key: 'time_simulation', enabled: simulation, payload_json: FROZEN }],
      },
    }) as never,
  );
  const db = mockSupabase({
    spar_requests: [
      {
        data: {
          id: REQUEST,
          asker_global_person_id: MARC,
          receiver_global_person_id: JULIE,
          status: 'agreed',
          spar_day: '2027-05-23',
          zone: 'Europe/Paris',
          expires_at: '2027-05-24T04:00:00+00:00',
        },
        error: null,
      },
      { data: [{ id: REQUEST }], error: null },
    ],
    global_persons: { rows: [{ id: JULIE, claimed_by_user_id: 'acc-j' }] },
  });
  Object.assign(db, {
    getAuthAdminUser: vi.fn(async () => ({ ok: true, status: 200, data: { email: null } })),
  });
  const after = new SparAfterService(db as never, { sendImmediate: vi.fn() } as never);
  return { flags, after, db };
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  const err = (await promise.then(
    () => undefined,
    (e: unknown) => e,
  )) as HttpException | undefined;
  return (err?.getResponse() as { code?: string } | undefined)?.code;
}

describe('SparAfterService.markDone on the platform clock', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(REAL);
  });
  afterEach(() => vi.useRealTimers());

  it('marks a spar of the simulated day done while real time is months before it', async () => {
    const { flags, after, db } = setup(true);
    await after.markDone(MARC, REQUEST, await flags.platformNow());
    expect(writesTo(db, 'spar_requests').map((w) => w.row)).toEqual([{ status: 'done' }]);
  });

  it('is not open yet on real time, with no simulation', async () => {
    const { flags, after, db } = setup(false);
    expect(await codeOf(after.markDone(MARC, REQUEST, await flags.platformNow()))).toBe('not_open');
    expect(writesTo(db, 'spar_requests')).toEqual([]);
  });
});
