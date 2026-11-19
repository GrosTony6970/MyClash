import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import { RecapTab } from './RecapTab';

/**
 * Ruling 889: a regenerated recap is a draft, and the published one stays on the public page until
 * the organiser publishes the new text. The tab says so, and still lets them take the live one down.
 */
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

async function open(recap: { status: 'draft' | 'published'; publishedAt: string | null }) {
  vi.mocked(apiRequest).mockReset();
  vi.mocked(apiRequest).mockResolvedValue({
    ok: true,
    data: { content: 'Recap text', generatedAt: '2026-11-19T10:00:00Z', model: null, ...recap },
  } as never);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <I18nProvider locale="en">
        <RecapTab tournamentId="t-1" closedWhy={undefined} />
      </I18nProvider>,
    );
  });
}

const buttons = () => [...document.body.querySelectorAll('button')].map((b) => b.textContent);
const LIVE_NOTE = 'The published recap stays on the public page until you publish this new text.';

describe('the recap tab while a newer draft waits behind a published recap (ruling 889)', () => {
  it('says the published recap stays live, and offers Publish and Unpublish', async () => {
    await open({ status: 'draft', publishedAt: '2026-11-18T10:00:00Z' });

    expect(document.body.textContent).toContain(LIVE_NOTE);
    expect(buttons()).toEqual(expect.arrayContaining(['Publish', 'Unpublish']));
  });

  it('a draft with nothing published: Publish only, no note', async () => {
    await open({ status: 'draft', publishedAt: null });

    expect(document.body.textContent).not.toContain(LIVE_NOTE);
    expect(buttons()).toContain('Publish');
    expect(buttons()).not.toContain('Unpublish');
  });

  it('the published text itself: Unpublish only, no note', async () => {
    await open({ status: 'published', publishedAt: '2026-11-18T10:00:00Z' });

    expect(document.body.textContent).not.toContain(LIVE_NOTE);
    expect(buttons()).toContain('Unpublish');
    expect(buttons()).not.toContain('Publish');
  });
});
