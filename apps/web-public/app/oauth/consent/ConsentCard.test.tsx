// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ConsentView } from '@myclash/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../src/i18n/I18nProvider';
import { ConsentCard } from './ConsentCard';
import { answerConsent } from './consent-requests';

vi.mock('./consent-requests', () => ({ answerConsent: vi.fn() }));

/**
 * What a person reads before Claude gets their account: who asks, where they go back to, what
 * Claude will see, and two buttons. A request for any other site gets no Approve button at all.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Shown = Exclude<ConsentView, { kind: 'go' }>;

let container: HTMLDivElement;
let root: Root;
let assign: ReturnType<typeof vi.fn>;
const answer = vi.mocked(answerConsent);

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, assign });
  answer.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function show(view: Shown) {
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <ConsentCard authorizationId="auth-1" view={view} />
      </I18nProvider>,
    );
  });
}

const buttons = () => [...container.querySelectorAll('button')].map((b) => b.textContent);
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === label)!;

const ASK: Shown = { kind: 'ask', clientName: 'Claude', callback: 'claude', scopes: ['openid'] };

describe('ConsentCard', () => {
  it('asks: names the client, where you go back to, the privacy notice and two buttons', async () => {
    await show(ASK);
    const text = container.textContent ?? '';
    expect(text).toContain('Connect Claude to your MyClash account');
    expect(text).toContain('After you approve, you go back to Claude.');
    expect(text).toContain('send it to Anthropic');
    expect(text).toContain('Account › Security');
    expect(buttons()).toEqual(['Approve', 'Deny']);
  });

  it('names Claude Code on this computer for a local callback', async () => {
    await show({ ...ASK, callback: 'this-computer' } as Shown);
    expect(container.textContent).toContain('you go back to Claude Code on this computer.');
  });

  it('refuses another site: says the host and shows no Approve button', async () => {
    await show({ kind: 'refused', reason: 'not-claude', redirectHost: 'evil.example' });
    expect(container.textContent).toContain(
      'MyClash only connects to Claude. This request would send your account to evil.example, so it was refused.',
    );
    expect(buttons()).not.toContain('Approve');
  });

  it('names an empty host in neutral words', async () => {
    await show({ kind: 'refused', reason: 'not-claude', redirectHost: '' });
    expect(container.textContent).toContain('to an unknown address, so it was refused');
  });

  it('says an expired request has expired, with no buttons', async () => {
    await show({ kind: 'expired' });
    expect(container.textContent).toContain('This request has expired. Start again from Claude.');
    expect(buttons()).toEqual([]);
  });

  it('approve answers the server, then sends the browser to the redirect', async () => {
    answer.mockResolvedValue({ redirectUrl: 'https://claude.ai/cb?code=1' });
    await show(ASK);
    await act(async () => button('Approve').click());
    expect(answer).toHaveBeenCalledWith('auth-1', 'approve');
    expect(assign).toHaveBeenCalledWith('https://claude.ai/cb?code=1');
  });

  it('deny sends the browser to the redirect Claude gets the refusal from', async () => {
    answer.mockResolvedValue({ redirectUrl: 'https://claude.ai/cb?error=access_denied' });
    await show(ASK);
    await act(async () => button('Deny').click());
    expect(answer).toHaveBeenCalledWith('auth-1', 'deny');
    expect(assign).toHaveBeenCalledWith('https://claude.ai/cb?error=access_denied');
  });

  it('disables both buttons while an answer is on its way', async () => {
    answer.mockReturnValue(new Promise(() => undefined));
    await show(ASK);
    await act(async () => button('Approve').click());
    expect(button('Approve').disabled).toBe(true);
    expect(button('Deny').disabled).toBe(true);
  });

  it('switches to the refused view when the server refuses, and to expired when it is gone', async () => {
    answer.mockResolvedValueOnce({ kind: 'refused' });
    await show(ASK);
    await act(async () => button('Approve').click());
    expect(container.textContent).toContain('so it was refused');
    expect(buttons()).not.toContain('Approve');
    expect(assign).not.toHaveBeenCalled();
  });

  it('sends a lapsed login to sign-in with a way back, and keeps the buttons off', async () => {
    const replace = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign, replace });
    answer.mockResolvedValueOnce({
      kind: 'login',
      href: '/login?next=%2Foauth%2Fconsent%3Fauthorization_id%3Dauth-1',
    });
    await show(ASK);
    await act(async () => button('Approve').click());
    expect(replace).toHaveBeenCalledWith(
      '/login?next=%2Foauth%2Fconsent%3Fauthorization_id%3Dauth-1',
    );
    expect(assign).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('says to try again on a network failure, and leaves the buttons live', async () => {
    answer.mockResolvedValueOnce({ kind: 'network' });
    await show(ASK);
    await act(async () => button('Approve').click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Try again');
    expect(button('Approve').disabled).toBe(false);
  });
});
