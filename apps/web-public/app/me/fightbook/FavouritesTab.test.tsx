// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import type { FindCard } from '@myclash/types';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../src/i18n/I18nProvider';
import { FavouritesTab } from './FavouritesTab';

/** Julie opens Favourites: Marc and Ines, by name, each with a heart and "Ask to spar". */
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const card = (id: string, name: string): FindCard => ({
  fighter: { globalPersonId: id, name, photoUrl: null, club: null },
  weapons: ['Longsword'],
  favourite: true,
});
const LIST = ['/api', 'v1', 'me/fightbook/favourites'].join('/');

let container: HTMLDivElement;
let root: Root;
const onHearted = vi.fn();
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.mocked(apiRequest).mockReset();
  onHearted.mockReset();
});

const settled = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
async function show() {
  await act(async () =>
    root.render(
      <I18nProvider locale="en">
        <FavouritesTab apiUrl="http://api.test" onSent={vi.fn()} onHearted={onHearted} />
      </I18nProvider>,
    ),
  );
  await settled();
}
const names = () =>
  [...container.querySelectorAll('[data-find-card] p:first-of-type')].map((p) => p.textContent);
const heartOf = (name: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="Remove ${name} from favourites"]`);

describe('the Favourites tab', () => {
  it('lists the favourites with a heart and Ask to spar', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      ok: true,
      data: [card('gp-1', 'Ines'), card('gp-2', 'Marc')],
    } as never);
    await show();
    expect(vi.mocked(apiRequest).mock.calls[0]?.[1]).toBe(LIST);
    expect(names()).toEqual(['Ines', 'Marc']);
    expect(heartOf('Ines')?.getAttribute('aria-pressed')).toBe('true');
    const asks = [...container.querySelectorAll('button')].filter(
      (b) => b.textContent === 'Ask to spar',
    );
    expect(asks).toHaveLength(2);
  });

  it('drops a card when its heart is removed, and tells the page', async () => {
    vi.mocked(apiRequest).mockImplementation((async (
      _url: string,
      _path: string,
      init?: { method?: string },
    ) =>
      init?.method === 'DELETE'
        ? { ok: true, data: undefined }
        : { ok: true, data: [card('gp-1', 'Ines'), card('gp-2', 'Marc')] }) as never);
    await show();
    await act(async () => heartOf('Ines')!.click());
    await settled();
    expect(names()).toEqual(['Marc']);
    expect(onHearted).toHaveBeenCalledWith('gp-1', false);
  });

  it('keeps the card and says why when the removal is refused', async () => {
    vi.mocked(apiRequest).mockImplementation((async (
      _url: string,
      _path: string,
      init?: { method?: string },
    ) =>
      init?.method === 'DELETE'
        ? { ok: false, kind: 'network' }
        : { ok: true, data: [card('gp-1', 'Ines')] }) as never);
    await show();
    await act(async () => heartOf('Ines')!.click());
    await settled();
    expect(names()).toEqual(['Ines']);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(onHearted).not.toHaveBeenCalled();
  });

  it('says so when there are none, and when the read fails', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ ok: true, data: [] } as never);
    await show();
    expect(container.textContent).toContain('No favourites yet');
    vi.mocked(apiRequest).mockResolvedValue({ ok: false, kind: 'network' } as never);
    await act(async () => root.render(null));
    await show();
    expect(container.textContent).toContain('Your favourites could not be loaded.');
  });
});
