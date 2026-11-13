import { ForbiddenException } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { Identity } from '../../common/auth/identity';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { ThrottleFightBookAsk } from '../../common/throttling/throttle-fightbook-ask';
import { ThrottleFightBookQrMint } from '../../common/throttling/throttle-fightbook-qr-mint';
import { ThrottleFightBookScan } from '../../common/throttling/throttle-fightbook-scan';
import { FightBookFloorController, scanSchema } from './fightbook-floor.controller';

const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const ACCOUNT = '9a8b7c6d-1111-4222-8333-944455566677';
const EVENT = 'eeeeeeee-0000-4000-8000-00000000000a';
const CODE = `fb:${'Qx7-'.repeat(10)}abc`;
const claimed: Identity = { kind: 'claimed', userId: ACCOUNT, email: null };
const req = () => ({ identity: claimed }) as unknown as FastifyRequest;

/** Marc's live profile, FightBook switched OFF unless `on`. */
function controller({ on = false } = {}) {
  const supabase = mockSupabase({
    global_persons: {
      rows: [
        {
          id: MARC,
          claimed_by_user_id: ACCOUNT,
          fightbook_enabled: on,
          deleted_at: null,
          merged_into_id: null,
          account_deleted_at: null,
        },
      ],
    },
  });
  const qr = {
    mint: vi.fn(async () => ({ code: CODE, expiresAt: '2026-05-23T14:05:00.000Z' })),
    scan: vi.fn(async () => ({ id: 'spar-1' })),
  };
  const ctl = new FightBookFloorController(
    supabase as never,
    {} as never,
    {} as never,
    qr as never,
  );
  return { ctl, qr };
}

const code = async (call: Promise<unknown>) => {
  const error = await call.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ForbiddenException);
  return ((error as ForbiddenException).getResponse() as { code: string }).code;
};

const AT_EVENT = { code: CODE, weapons: ['Longsword'], eventId: EVENT };
const ELSEWHERE = {
  code: CODE,
  weapons: ['Longsword'],
  place: 'Salle Probe',
  zone: 'Europe/Paris',
};

describe('FightBookFloorController, my FightBook QR', () => {
  it('mints a code for the caller own profile', async () => {
    const { ctl, qr } = controller({ on: true });
    expect(await ctl.mintQr(req())).toEqual({ code: CODE, expiresAt: '2026-05-23T14:05:00.000Z' });
    expect(qr.mint).toHaveBeenCalledWith(MARC);
  });

  it('scans as the caller own profile', async () => {
    const { ctl, qr } = controller({ on: true });
    expect(await ctl.scanQr(ELSEWHERE, req())).toEqual({ id: 'spar-1' });
    expect(qr.scan).toHaveBeenCalledWith(MARC, ELSEWHERE);
  });

  it('refuses both with FightBook off (they add presence)', async () => {
    const { ctl, qr } = controller();
    expect(await code(ctl.mintQr(req()))).toBe('fightbook_off');
    expect(await code(ctl.scanQr(AT_EVENT, req()))).toBe('fightbook_off');
    expect(qr.mint).not.toHaveBeenCalled();
    expect(qr.scan).not.toHaveBeenCalled();
  });

  it.each(['mintQr', 'scanQr'] as const)('%s answers 201', (name) => {
    const handler = FightBookFloorController.prototype[name];
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(201);
  });

  it('throttles the mint and the scan each in its own bucket, never the asks’ (Ruling L)', () => {
    const markerOf = (decorator: () => MethodDecorator) => {
      const probe = { handler() {} };
      const descriptor = Object.getOwnPropertyDescriptor(probe, 'handler')!;
      decorator()(probe, 'handler', descriptor);
      return Reflect.getMetadataKeys(probe.handler)[0] as string;
    };
    const marked = (decorator: () => MethodDecorator, name: keyof FightBookFloorController) =>
      Reflect.getMetadata(markerOf(decorator), FightBookFloorController.prototype[name]) === true;
    expect(marked(ThrottleFightBookQrMint, 'mintQr')).toBe(true);
    expect(marked(ThrottleFightBookScan, 'mintQr')).toBe(false);
    expect(marked(ThrottleFightBookScan, 'scanQr')).toBe(true);
    expect(marked(ThrottleFightBookQrMint, 'scanQr')).toBe(false);
    expect(marked(ThrottleFightBookAsk, 'scanQr')).toBe(false);
    expect(marked(ThrottleFightBookAsk, 'mintQr')).toBe(false);
  });

  it('takes a scan at an Event or at a place, nothing else', () => {
    expect(scanSchema.safeParse(AT_EVENT).success).toBe(true);
    expect(scanSchema.safeParse(ELSEWHERE).success).toBe(true);
    // Any text is a code here: one without fb: is the service's 400 bad_code, not a schema 400.
    expect(scanSchema.safeParse({ ...ELSEWHERE, code: 'not-ours' }).success).toBe(true);
    for (const bad of [
      { ...AT_EVENT, place: 'Hall B' },
      { ...AT_EVENT, eventId: 'not-a-uuid' },
      { ...AT_EVENT, weapons: [] },
      { ...AT_EVENT, weapons: ['a', 'b', 'c', 'd', 'e', 'f'] },
      { ...AT_EVENT, code: '' },
      { ...AT_EVENT, code: 'x'.repeat(201) },
      { ...AT_EVENT, receiverGlobalPersonId: MARC },
      { weapons: ['Longsword'], eventId: EVENT },
    ]) {
      expect(scanSchema.safeParse(bad).success).toBe(false);
    }
  });
});
