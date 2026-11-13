/**
 * The QR test world (FightBook slice 5, Task 6): Marc scans Julie's FightBook QR. An Event from
 * Friday 2026-05-22 to Sunday 05-24 in New York (UTC-4 in May), Marc on its roster. NOW is
 * 10:00 there on Saturday, and already 02:00 on Sunday in Auckland. Test-only.
 */
import type { HttpException } from '@nestjs/common';
import { vi, type Mock } from 'vitest';
import { mockSupabase, type SupabaseRow } from '../../common/testing/supabase-chain';
import { SparQrService } from './spar-qr.service';

export const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
export const JULIE = '1c8d4b63-8e6a-4b68-8a66-2c2a4a6d3b12';
export const PAUL = '2d9e5c74-9f7b-4c79-9b77-3d3b5b7e4c23';
export const EVENT = 'eeeeeeee-0000-4000-8000-00000000000a';
export const REQUEST = '5b000000-0000-4000-8000-00000000000a';
export const JULIE_ACCOUNT = '9a8b7c6d-1111-4222-8333-944455566602';
export const NOW = new Date('2026-05-23T14:00:00Z');

/** What Julie's QR shows: `fb:` and a 43-character secret, as `mintPassToken` makes them. */
export const CODE = `fb:${'Qx7-'.repeat(10)}abc`;

export const publicEvent: SupabaseRow = {
  id: EVENT,
  status: 'published',
  organization_id: 'a0000000-0000-4000-8000-000000000001',
  event_kind: 'standard',
  start_date: '2026-05-22',
  end_date: '2026-05-24',
  timezone: 'America/New_York',
};

/** What `fightbook_qr_log` answers: the request's id, and whether to tell the shower. */
export type QrLogAnswer = {
  data: unknown;
  error: { code?: string; message: string } | null;
};

export const logged = (notify: boolean): QrLogAnswer => ({
  data: { id: REQUEST, notify },
  error: null,
});

/**
 * Marc's scan of Julie's code. `logged` is the database's answer; `send` the notice queue's.
 * The `spar_requests` row is the one the database wrote (the notice reads its receiver).
 */
export function qrWorld({
  event = publicEvent as SupabaseRow | null,
  roster = true,
  answer = logged(true),
  send = vi.fn(async () => undefined) as Mock,
  codes = [] as SupabaseRow[],
} = {}) {
  const supabase = mockSupabase(
    {
      events: { rows: event ? [event] : [] },
      persons: {
        rows: roster ? [{ id: 'p-1', event_id: EVENT, global_person_id: MARC }] : [],
      },
      weapon_catalog: {
        rows: [
          { name: 'Longsword', active: true },
          { name: 'Sabre', active: true },
          { name: 'Rapier', active: false },
        ],
      },
      global_persons: { rows: [{ id: JULIE, claimed_by_user_id: JULIE_ACCOUNT }] },
      spar_requests: {
        rows: [{ id: REQUEST, asker_global_person_id: MARC, receiver_global_person_id: JULIE }],
      },
      fightbook_qr_codes: { rows: codes },
    },
    { fightbook_qr_log: () => answer as never },
  );
  const getAuthAdminUser = vi.fn(async (id: string) => ({
    ok: true,
    status: 200,
    data: { id, email: 'julie@example.test' },
  }));
  Object.assign(supabase, { getAuthAdminUser });
  const qr = new SparQrService(supabase as never, { sendImmediate: send } as never);
  return { qr, supabase, send };
}

/** The payload of the one `fightbook_qr_log` call. */
export const qrLogArgs = (supabase: ReturnType<typeof qrWorld>['supabase']) =>
  supabase.rpc.mock.calls[0]?.[1] as Record<string, unknown>;

/** A refusal's status and `code`; `[0, undefined]` when the call went through. */
export async function refusalOf(promise: Promise<unknown>): Promise<[number, string | undefined]> {
  try {
    await promise;
  } catch (e) {
    const err = e as HttpException;
    return [err.getStatus(), (err.getResponse() as { code?: string }).code];
  }
  return [0, undefined];
}

/** Lets a started, un-awaited notice run to its send. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
