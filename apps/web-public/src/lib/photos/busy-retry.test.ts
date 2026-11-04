import { describe, expect, it, vi } from 'vitest';
import type { ApiResult } from '@myclash/api-client';
import { BUSY_RETRIES, busyDelayMs, sendRetryingBusy } from './busy-retry';

const busy: ApiResult<string> = {
  ok: false,
  kind: 'http',
  status: 503,
  detail: 'Many photos are arriving at once; retrying shortly.',
  code: 'photos_busy',
  details: null,
  validationErrors: null,
};
const sent: ApiResult<string> = { ok: true, data: 'p1' };
const linkInvalid: ApiResult<string> = {
  ok: false,
  kind: 'unauthenticated',
  status: 403,
  detail: 'This photo link is not valid.',
  code: 'photo_link_invalid',
  details: null,
};

function answers(...results: ApiResult<string>[]) {
  const send = vi.fn<() => Promise<ApiResult<string>>>();
  for (const result of results) send.mockResolvedValueOnce(result);
  return send;
}

describe('the pause before asking a busy API again', () => {
  it('doubles from 2 s, with half to one and a half of it as jitter, and stops at 16 s', () => {
    expect(busyDelayMs(0, () => 0)).toBe(1000);
    expect(busyDelayMs(0, () => 1)).toBe(3000);
    expect(busyDelayMs(1, () => 0.5)).toBe(4000);
    expect(busyDelayMs(3, () => 0.5)).toBe(16000);
    expect(busyDelayMs(4, () => 0.5)).toBe(16000);
  });
});

describe('a send the API was too busy for', () => {
  it('is sent again after each pause until it lands', async () => {
    const send = answers(busy, busy, sent);
    const wait = vi.fn(() => Promise.resolve());
    const onBusy = vi.fn();
    const random = () => 0.25;

    await expect(sendRetryingBusy(send, { wait, random, onBusy })).resolves.toEqual(sent);
    expect(send).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[busyDelayMs(0, random)], [busyDelayMs(1, random)]]);
    expect(onBusy.mock.calls).toEqual([[0], [1]]);
  });

  it(`is given up after ${BUSY_RETRIES} pauses, and the last busy answer is returned`, async () => {
    const send = answers(...Array<ApiResult<string>>(BUSY_RETRIES + 1).fill(busy));
    const wait = vi.fn(() => Promise.resolve());

    await expect(
      sendRetryingBusy(send, { wait, random: () => 0, onBusy: vi.fn() }),
    ).resolves.toEqual(busy);
    expect(send).toHaveBeenCalledTimes(BUSY_RETRIES + 1);
    expect(wait).toHaveBeenCalledTimes(BUSY_RETRIES);
  });

  it('any other refusal is returned at once', async () => {
    const send = answers(linkInvalid);
    const wait = vi.fn(() => Promise.resolve());

    await expect(
      sendRetryingBusy(send, { wait, random: () => 0, onBusy: vi.fn() }),
    ).resolves.toEqual(linkInvalid);
    expect(send).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });
});
