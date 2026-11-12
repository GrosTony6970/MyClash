// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../src/i18n/I18nProvider';
import { FightBookTabs } from './FightBookTabs';

/** Favourites is the fourth tab, between My spars and Find, and `?tab=favourites` opens it. */
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));
let search = new URLSearchParams();
const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => search,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(apiRequest).mockResolvedValue({ ok: true, data: [] } as never);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.mocked(apiRequest).mockReset();
  replace.mockReset();
  search = new URLSearchParams();
});

async function show() {
  await act(async () =>
    root.render(
      <I18nProvider locale="en">
        <FightBookTabs
          apiUrl="http://api.test"
          data={{
            settings: { hasProfile: true, enabled: true },
            inbox: [],
            spars: { spars: [], sent: [] },
            blocks: [],
          }}
          update={vi.fn()}
          refresh={vi.fn()}
        />
      </I18nProvider>,
    ),
  );
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

describe('the Favourites tab in the tab bar', () => {
  it('sits between My spars and Find', async () => {
    await show();
    const labels = [...container.querySelectorAll('[role="tab"]')].map((b) => b.textContent);
    expect(labels).toEqual(['Inbox', 'My spars', 'Favourites', 'Find a partner']);
  });

  it('opens from ?tab=favourites and reads the list', async () => {
    search = new URLSearchParams('tab=favourites');
    await show();
    expect(container.textContent).toContain('No favourites yet');
    expect(vi.mocked(apiRequest).mock.calls.map(([, path]) => path)).toContain(
      ['/api', 'v1', 'me/fightbook/favourites'].join('/'),
    );
  });
});
