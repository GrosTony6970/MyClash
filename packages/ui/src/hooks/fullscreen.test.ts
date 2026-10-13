import { describe, expect, it, vi } from 'vitest';
import {
  fullscreenSupported,
  isFullscreen,
  toggleFullscreen,
  type FullscreenPage,
} from './useFullscreen';

/** A browser page that goes into fullscreen when asked, and out of it. */
function page(over: Partial<FullscreenPage> = {}) {
  const fake: FullscreenPage = {
    fullscreenEnabled: true,
    fullscreenElement: null,
    documentElement: {
      requestFullscreen: vi.fn(async () => {
        fake.fullscreenElement = fake.documentElement;
      }),
    },
    exitFullscreen: vi.fn(async () => {
      fake.fullscreenElement = null;
    }),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    ...over,
  };
  return fake;
}

describe('fullscreen — one tap on a TV screen', () => {
  it('a tap goes into fullscreen, the next one out of it', async () => {
    const tv = page();
    expect(isFullscreen(tv)).toBe(false);

    await toggleFullscreen(tv);
    expect(isFullscreen(tv)).toBe(true);
    expect(tv.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(tv.exitFullscreen).not.toHaveBeenCalled();

    await toggleFullscreen(tv);
    expect(isFullscreen(tv)).toBe(false);
    expect(tv.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(tv.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it('a request the browser refuses changes nothing, and does not throw', async () => {
    const tv = page({
      documentElement: { requestFullscreen: vi.fn(() => Promise.reject(new Error('refused'))) },
    });

    await expect(toggleFullscreen(tv)).resolves.toBeUndefined();
    expect(isFullscreen(tv)).toBe(false);
  });

  it('is supported only when the browser allows it and can do it', () => {
    expect(fullscreenSupported(page())).toBe(true);
    expect(fullscreenSupported(page({ fullscreenEnabled: false }))).toBe(false);
    expect(fullscreenSupported(page({ fullscreenEnabled: undefined }))).toBe(false);
    // A phone browser: the flag may be there, the method is not.
    expect(fullscreenSupported(page({ documentElement: {} }))).toBe(false);
  });
});
