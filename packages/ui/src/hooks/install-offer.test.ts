import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import {
  INSTALL_CAPTURE_SCRIPT,
  askToInstall,
  noInstallOffer,
  readInstallOffer,
  subscribeInstallOffer,
  type InstallHost,
} from './install-offer';

/**
 * A window as far as the offer goes: it sends events and keeps one. The inline
 * script runs on it as its TEXT, as the browser runs it, so the script and the
 * store are held to the same names.
 */
function browser() {
  const host: InstallHost = new EventTarget();
  runInNewContext(INSTALL_CAPTURE_SCRIPT, { window: host, Event });
  const changed = vi.fn();
  subscribeInstallOffer(changed, host);
  /** Chrome says the app can be installed. Answers the event. */
  const offer = (prompt = vi.fn(() => Promise.resolve())) => {
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt,
    });
    host.dispatchEvent(event);
    return event;
  };
  return { host, changed, offer };
}

describe('the install offer', () => {
  it('is kept when Chrome sends it, and Chrome shows no bar of its own', () => {
    const { host, changed, offer } = browser();
    expect(readInstallOffer(host)).toBeNull();

    const event = offer();

    expect(readInstallOffer(host)).toBe(event);
    expect(event.defaultPrevented).toBe(true);
    // The button hears it: the script and the store agree on the event name.
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('opens Chrome dialog once, and is gone after it', async () => {
    const { host, changed, offer } = browser();
    const event = offer();

    await askToInstall(host);
    await askToInstall(host);

    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(readInstallOffer(host)).toBeNull();
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('says in the console, and throws nothing, when Chrome refuses to open the dialog', async () => {
    const { host, offer } = browser();
    const refusal = new DOMException('not now', 'NotAllowedError');
    offer(vi.fn(() => Promise.reject(refusal)));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(askToInstall(host)).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[install]'), refusal);
    warn.mockRestore();
  });

  it('comes back when Chrome offers again after a "no"', async () => {
    const { host, offer } = browser();
    offer();
    await askToInstall(host);

    const again = offer();

    expect(readInstallOffer(host)).toBe(again);
  });

  it('is dropped once the app is installed', () => {
    const { host, changed, offer } = browser();
    offer();

    host.dispatchEvent(new Event('appinstalled'));

    expect(readInstallOffer(host)).toBeNull();
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('stops telling a listener that unsubscribed', () => {
    const host: InstallHost = new EventTarget();
    runInNewContext(INSTALL_CAPTURE_SCRIPT, { window: host, Event });
    const listener = vi.fn();
    const stop = subscribeInstallOffer(listener, host);

    stop();
    host.dispatchEvent(Object.assign(new Event('beforeinstallprompt'), { prompt: vi.fn() }));

    expect(listener).not.toHaveBeenCalled();
  });

  it('is never on the server', () => {
    expect(noInstallOffer()).toBeNull();
  });
});
