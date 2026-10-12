import { describe, expect, it, vi } from 'vitest';
import { startWakeLock } from './useWakeLock';

/** A browser's wake lock, and a page that can be hidden and shown. */
function browser(visible = true) {
  const listeners = new Set<() => void>();
  const locks: Array<{ release: ReturnType<typeof vi.fn>; taken: () => void }> = [];
  const request = vi.fn((_type: 'screen') => {
    let onRelease: () => void = () => undefined;
    const lock = {
      release: vi.fn(() => Promise.resolve()),
      addEventListener: (_event: 'release', listener: () => void) => {
        onRelease = listener;
      },
    };
    locks.push({ release: lock.release, taken: () => onRelease() });
    return Promise.resolve(lock);
  });
  const page = {
    visibilityState: visible ? 'visible' : 'hidden',
    addEventListener: (_type: 'visibilitychange', listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: 'visibilitychange', listener: () => void) =>
      listeners.delete(listener),
  };
  const show = (state: 'visible' | 'hidden') => {
    page.visibilityState = state;
    for (const listener of [...listeners]) listener();
  };
  return { host: { wakeLock: { request } }, page, request, locks, show, listeners };
}

/** The browser's answer has landed. */
const answered = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('startWakeLock — the screen stays awake while the page is shown', () => {
  it('asks for the screen lock at once', async () => {
    const { host, page, request } = browser();
    const stop = startWakeLock(host, page);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('screen');
    stop();
  });

  it('does not ask twice while it holds the lock', async () => {
    const { host, page, request, show } = browser();
    const stop = startWakeLock(host, page);
    await answered();

    show('visible');
    expect(request).toHaveBeenCalledTimes(1);
    stop();
  });

  // The browser takes the lock back when the page is hidden. Without a second
  // ask the tablet stays awake once, then sleeps in silence.
  it('asks again when the page is shown after the browser took the lock back', async () => {
    const { host, page, request, locks, show } = browser();
    const stop = startWakeLock(host, page);
    await answered();

    show('hidden');
    locks[0]?.taken();
    expect(request).toHaveBeenCalledTimes(1);
    show('visible');
    expect(request).toHaveBeenCalledTimes(2);
    stop();
  });

  it('waits for the page to be shown when it starts hidden', () => {
    const { host, page, request, show } = browser(false);
    const stop = startWakeLock(host, page);

    expect(request).not.toHaveBeenCalled();
    show('visible');
    expect(request).toHaveBeenCalledTimes(1);
    stop();
  });

  it('gives the lock back when the screen is left, and asks no more', async () => {
    const { host, page, request, locks, show, listeners } = browser();
    const stop = startWakeLock(host, page);
    await answered();
    stop();

    expect(locks[0]?.release).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
    show('visible');
    expect(request).toHaveBeenCalledTimes(1);
  });

  // The race: the screen is left while the browser still answers.
  it('does not keep a lock that arrives after the screen was left', async () => {
    const { host, page, locks } = browser();
    startWakeLock(host, page)();
    await answered();

    expect(locks[0]?.release).toHaveBeenCalledTimes(1);
  });

  // Low battery, power saver: the browser refuses. Nothing is said, and the
  // next time the page is shown the lock is asked for again.
  it('says nothing when the browser refuses, and asks again the next time the page is shown', async () => {
    const { page, show } = browser();
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error('NotAllowedError'))
      .mockResolvedValue({ release: () => Promise.resolve(), addEventListener: () => undefined });
    const stop = startWakeLock({ wakeLock: { request } }, page);
    await answered();

    show('visible');
    expect(request).toHaveBeenCalledTimes(2);
    stop();
  });

  it('does nothing on a browser with no wake lock', () => {
    const { page, show } = browser();

    const stop = startWakeLock({}, page);
    expect(() => show('visible')).not.toThrow();
    expect(() => stop()).not.toThrow();
  });
});
