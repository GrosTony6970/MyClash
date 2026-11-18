import { describe, expect, it, vi } from 'vitest';
import {
  INSTALL_CAPTURE_SCRIPT,
  askToInstall,
  captureInstallOffer,
  noInstallOffer,
  readInstallOffer,
  subscribeInstallOffer,
  type InstallHost,
} from './install-offer';

/** A window as far as the offer goes: it sends events and keeps one. */
function browser() {
  const host: InstallHost = new EventTarget();
  captureInstallOffer(host);
  const changed = vi.fn();
  subscribeInstallOffer(changed, host);
  /** Chrome says the app can be installed. Answers the event, and whether Chrome may show its own bar. */
  const offer = () => {
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: vi.fn(() => Promise.resolve()),
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
    // The button hears it: the capture and the store agree on the event name.
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
    captureInstallOffer(host);
    const listener = vi.fn();
    const stop = subscribeInstallOffer(listener, host);

    stop();
    host.dispatchEvent(Object.assign(new Event('beforeinstallprompt'), { prompt: vi.fn() }));

    expect(listener).not.toHaveBeenCalled();
  });

  it('is never on the server', () => {
    expect(noInstallOffer()).toBeNull();
  });

  it('is caught by an inline script that runs the capture on the page window', () => {
    expect(INSTALL_CAPTURE_SCRIPT.startsWith('(function captureInstallOffer(')).toBe(true);
    expect(INSTALL_CAPTURE_SCRIPT.endsWith(')(window);')).toBe(true);
    // Its text stands alone: the key and the event name are literals in it.
    expect(INSTALL_CAPTURE_SCRIPT).toContain('__myclashInstallOffer');
    expect(INSTALL_CAPTURE_SCRIPT).toContain('myclash:install-offer');
  });
});
