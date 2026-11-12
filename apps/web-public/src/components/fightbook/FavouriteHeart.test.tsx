// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../i18n/I18nProvider';
import { FavouriteHeart } from './FavouriteHeart';

/**
 * Julie hearts Marc. The heart flips at once; a refused write flips it back with a sentence; a
 * tap while the write runs sends nothing more.
 */
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
// Joined, not written whole: the route-contract test reads every /api/v1 literal as a real route.
const PATH = ['/api', 'v1', 'me/fightbook/favourites', MARC].join('/');

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
});

const heart = () => container.querySelector('button')!;
const settled = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

async function show(favourite: boolean, onChanged?: (f: boolean) => void) {
  await act(async () =>
    root.render(
      <I18nProvider locale="en">
        <FavouriteHeart
          apiUrl="http://api.test"
          globalPersonId={MARC}
          name="Marc Probe"
          favourite={favourite}
          onChanged={onChanged}
        />
      </I18nProvider>,
    ),
  );
}

describe('FavouriteHeart', () => {
  it('is a toggle button whose label names the fighter', async () => {
    await show(false);
    expect(heart().getAttribute('aria-pressed')).toBe('false');
    expect(heart().getAttribute('aria-label')).toBe('Add Marc Probe to favourites');
    await show(true);
    expect(heart().getAttribute('aria-pressed')).toBe('true');
    expect(heart().getAttribute('aria-label')).toBe('Remove Marc Probe from favourites');
  });

  it('flips at once, sends PUT, and tells the page when the write wins', async () => {
    let answer: (v: unknown) => void = () => undefined;
    vi.mocked(apiRequest).mockReturnValue(new Promise((r) => (answer = r)) as never);
    const onChanged = vi.fn();
    await show(false, onChanged);
    await act(async () => heart().click());
    expect(heart().getAttribute('aria-pressed')).toBe('true');
    expect(heart().disabled).toBe(true);
    expect(vi.mocked(apiRequest).mock.calls[0]?.[1]).toBe(PATH);
    expect(vi.mocked(apiRequest).mock.calls[0]?.[2]).toMatchObject({ method: 'PUT' });
    await act(async () => answer({ ok: true, data: undefined }));
    expect(onChanged).toHaveBeenCalledWith(true);
    expect(heart().getAttribute('aria-pressed')).toBe('true');
    expect(heart().disabled).toBe(false);
  });

  it('removes with DELETE', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ ok: true, data: undefined } as never);
    const onChanged = vi.fn();
    await show(true, onChanged);
    await act(async () => heart().click());
    await settled();
    expect(vi.mocked(apiRequest).mock.calls[0]?.[2]).toMatchObject({ method: 'DELETE' });
    expect(onChanged).toHaveBeenCalledWith(false);
  });

  it('flips back with a sentence when the write fails', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ ok: false, kind: 'network' } as never);
    const onChanged = vi.fn();
    await show(false, onChanged);
    await act(async () => heart().click());
    await settled();
    expect(heart().getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Something went wrong. Try again.',
    );
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('says favourites_full in its own sentence', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      ok: false,
      kind: 'http',
      status: 409,
      code: 'favourites_full',
    } as never);
    await show(false);
    await act(async () => heart().click());
    await settled();
    expect(heart().getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'You have 200 favourites. Remove one to add another.',
    );
  });

  it('follows the page when no write is running', async () => {
    await show(false);
    await show(true);
    expect(heart().getAttribute('aria-pressed')).toBe('true');
  });
});
