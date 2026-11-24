// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ConnectedApps } from '@myclash/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../src/i18n/I18nProvider';
import { ConnectedAppsSection } from './ConnectedAppsSection';
import { readConnectedApps, requestDisconnectApp } from './security-requests';

vi.mock('./security-requests', () => ({
  readConnectedApps: vi.fn(),
  requestDisconnectApp: vi.fn(),
}));
const signInAgainHere = vi.fn();
vi.mock('../../../src/lib/sign-in-return', () => ({ signInAgainHere: () => signInAgainHere() }));

/**
 * What Marie reads about the apps connected to her account: each by name with the day it was
 * connected, a Disconnect button, and the hour Claude may keep access after.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const read = vi.mocked(readConnectedApps);
const disconnectApp = vi.mocked(requestDisconnectApp);

const CLAUDE = { clientId: 'client-uuid-1', name: 'Claude', grantedAt: '2026-11-20T10:00:00Z' };
const LISTED: ConnectedApps = { apps: [CLAUDE] };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  read.mockReset();
  disconnectApp.mockReset();
  signInAgainHere.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function show(locale: 'en' | 'fr' = 'en') {
  await act(async () => {
    root.render(
      <I18nProvider locale={locale}>
        <ConnectedAppsSection apiUrl="https://api.example.test" />
      </I18nProvider>,
    );
  });
}

const text = () => container.textContent ?? '';
const disconnectButton = () =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Disconnect'))!;

describe('ConnectedAppsSection', () => {
  it('lists each app by name with the day it was connected, and the hour Claude may keep access', async () => {
    read.mockResolvedValue(LISTED);
    await show();

    expect(text()).toContain('Connected apps');
    expect(text()).toContain('Claude');
    expect(text()).toContain('Connected on 20 November 2026');
    expect(text()).toContain('Claude may keep access for up to an hour after you disconnect.');
    expect(disconnectButton()).toBeTruthy();
  });

  it('writes the day in the reader’s language', async () => {
    read.mockResolvedValue(LISTED);
    await show('fr');

    expect(text()).toContain('Connectée le 20 novembre 2026');
  });

  it('never shows the app id', async () => {
    read.mockResolvedValue(LISTED);
    await show();

    expect(text()).not.toContain('client-uuid-1');
  });

  it('says no app is connected for an empty list', async () => {
    read.mockResolvedValue({ apps: [] });
    await show();

    expect(text()).toContain('No app is connected to your account.');
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('says it could not load, and does not say no app is connected, when the read fails', async () => {
    read.mockResolvedValue('failed');
    await show();

    expect(text()).toContain('Could not load your connected apps.');
    expect(text()).not.toContain('No app is connected');
  });

  it('sends a person with an ended session to sign in again', async () => {
    read.mockResolvedValue('session_ended');
    await show();

    expect(signInAgainHere).toHaveBeenCalledTimes(1);
  });

  it('removes the row after Disconnect, by that app’s id', async () => {
    read.mockResolvedValue(LISTED);
    disconnectApp.mockResolvedValue('ok');
    await show();

    await act(async () => disconnectButton().click());

    expect(disconnectApp).toHaveBeenCalledWith('https://api.example.test', 'client-uuid-1');
    expect(text()).toContain('No app is connected to your account.');
    expect(text()).not.toContain('Claude may keep access');
  });

  it('keeps the row and says so when the disconnect fails', async () => {
    read.mockResolvedValue(LISTED);
    disconnectApp.mockResolvedValue('failed');
    await show();

    await act(async () => disconnectButton().click());

    expect(text()).toContain('Could not disconnect Claude. Try again.');
    expect(disconnectButton()).toBeTruthy();
    expect((disconnectButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it('turns the button off while the disconnect is in flight', async () => {
    read.mockResolvedValue(LISTED);
    let finish: (answer: 'ok') => void = () => undefined;
    disconnectApp.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await show();

    await act(async () => disconnectButton().click());
    expect((disconnectButton() as HTMLButtonElement).disabled).toBe(true);

    await act(async () => finish('ok'));
    expect(text()).toContain('No app is connected to your account.');
  });
});
