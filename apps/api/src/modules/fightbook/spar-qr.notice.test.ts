import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QrScanInput } from './spar-qr.service';
import {
  CODE,
  JULIE,
  JULIE_ACCOUNT,
  MARC,
  NOW,
  REQUEST,
  qrWorld,
  settle,
} from './spar-qr.fixtures';

const elsewhere: QrScanInput = {
  code: CODE,
  weapons: ['Longsword'],
  place: 'Salle Probe',
  zone: 'Pacific/Auckland',
};
const NOT_SENT = `FightBook spar_request_received of ${REQUEST} was not sent: `;

// The notice to the fighter whose code was scanned runs after the scan answers; a failure there is
// logged with the request id, and the line says our own words, a database code or an error's kind.
describe('SparQrService.scan, the notice to the shower when it fails', () => {
  const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  afterEach(() => error.mockClear());

  async function scanThen(world: ReturnType<typeof qrWorld>) {
    await world.qr.scan(MARC, elsewhere, NOW);
    await settle();
    await settle();
  }

  it('an unreadable request logs the database code, never its message', async () => {
    const world = qrWorld({
      request: { data: null, error: { code: '22P02', message: `bad uuid "${JULIE}"` } },
    });
    await scanThen(world);
    expect(world.send).not.toHaveBeenCalled();
    expect(error.mock.calls).toEqual([[`${NOT_SENT}the request is unreadable (22P02)`]]);
  });

  it('a request that is gone logs our own words', async () => {
    const world = qrWorld({ request: { rows: [] } });
    await scanThen(world);
    expect(world.send).not.toHaveBeenCalled();
    expect(error.mock.calls).toEqual([[`${NOT_SENT}the request was not found`]]);
  });

  it('an unexpected throw logs its kind', async () => {
    const world = qrWorld();
    const from = world.supabase.from.getMockImplementation()!;
    world.supabase.from.mockImplementation((table: string) => {
      if (table === 'spar_requests') throw new TypeError(`fetch failed for ${JULIE}`);
      return from(table);
    });
    await scanThen(world);
    expect(error.mock.calls).toEqual([[`${NOT_SENT}TypeError`]]);
  });

  it('a failed send logs its kind: the queue names the account', async () => {
    const send = vi.fn(async () => {
      throw new TypeError(`job spar_request_received:${REQUEST}:${JULIE_ACCOUNT} failed`);
    });
    const world = qrWorld({ send });
    await scanThen(world);
    expect(send).toHaveBeenCalledTimes(1);
    expect(error.mock.calls).toEqual([[`${NOT_SENT}TypeError`]]);
  });
});
