// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, fetchMe } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../i18n/I18nProvider';
import { ProfileAskToSpar } from './ProfileAskToSpar';

/**
 * Julie opens Marc's public profile. The page is public, so the button loads after it, and only for
 * a signed-in fighter: every other answer draws nothing, and a visitor who is not signed in costs
 * one /me call and no `askable` read.
 */
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
  fetchMe: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const ASKABLE_PATH = `/api/v1/me/fightbook/fighters/${MARC}/askable`;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.mocked(apiRequest).mockReset();
  vi.mocked(fetchMe).mockReset();
});

const settled = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

const signedAs = (type: 'claimed' | 'guest' | 'anonymous') =>
  vi.mocked(fetchMe).mockResolvedValue({ ok: true, data: { type } } as never);

const askableReads = () =>
  vi.mocked(apiRequest).mock.calls.filter(([, path]) => path === ASKABLE_PATH);

async function show(fighterId = MARC) {
  await act(async () =>
    root.render(
      <I18nProvider locale="en">
        <ProfileAskToSpar fighterId={fighterId} name="Marc Probe" apiUrl="http://api.test" />
      </I18nProvider>,
    ),
  );
  await settled();
}

describe('ProfileAskToSpar', () => {
  it('draws the button for a signed-in fighter who may be asked', async () => {
    signedAs('claimed');
    vi.mocked(apiRequest).mockResolvedValue({
      ok: true,
      data: { askable: true, favourite: false },
    } as never);
    await show();
    expect(container.querySelector('button')).not.toBeNull();
    expect(askableReads()).toHaveLength(1);
  });

  it('draws nothing before the read answers', async () => {
    signedAs('claimed');
    vi.mocked(apiRequest).mockReturnValue(new Promise(() => undefined) as never);
    await show();
    expect(container.innerHTML).toBe('');
  });

  it.each([
    ['a 401', { ok: false, kind: 'unauthenticated', status: 401 }],
    ['a 403', { ok: false, kind: 'unauthenticated', status: 403 }],
    ['a failure', { ok: false, kind: 'network' }],
    ['an empty body', { ok: true, data: {} }],
    ['askable false', { ok: true, data: { askable: false, favourite: false } }],
  ])('draws nothing for %s', async (_label, answer) => {
    signedAs('claimed');
    vi.mocked(apiRequest).mockResolvedValue(answer as never);
    await show();
    expect(container.innerHTML).toBe('');
  });

  it.each(['anonymous', 'guest'] as const)('reads nothing for a %s visitor', async (type) => {
    signedAs(type);
    await show();
    expect(askableReads()).toHaveLength(0);
    expect(container.innerHTML).toBe('');
  });

  it('reads nothing and draws nothing when /me fails', async () => {
    vi.mocked(fetchMe).mockResolvedValue({ ok: false, kind: 'network' } as never);
    await show();
    expect(askableReads()).toHaveLength(0);
    expect(container.innerHTML).toBe('');
  });

  it('asks /me nothing and reads nothing for an empty fighter id', async () => {
    signedAs('claimed');
    await show('');
    expect(fetchMe).not.toHaveBeenCalled();
    expect(apiRequest).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe('');
  });

  it('aborts its reads when the page unmounts', async () => {
    signedAs('claimed');
    vi.mocked(apiRequest).mockReturnValue(new Promise(() => undefined) as never);
    await show();
    const signal = vi.mocked(apiRequest).mock.calls[0]?.[2]?.signal;
    expect(signal?.aborted).toBe(false);
    act(() => root.unmount());
    expect(signal?.aborted).toBe(true);
    root = createRoot(container);
  });
});
