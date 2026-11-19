// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchRenewingLogin } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../src/i18n/I18nProvider';
import { InsightCard } from './InsightCard';

/**
 * Ruling 889: a regenerated insight is a draft, and the profile keeps the insight it shows until
 * the fighter shows the new text. The card says so, and still lets them make the live one private.
 */
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  fetchRenewingLogin: vi.fn(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: unknown }) => (
    <a href={href}>{children as never}</a>
  ),
}));

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

async function open(insight: { status: 'draft' | 'published'; publishedAt: string | null }) {
  vi.mocked(fetchRenewingLogin).mockReset();
  vi.mocked(fetchRenewingLogin).mockResolvedValue(
    new Response(
      JSON.stringify({ content: 'Insight text', generatedAt: '2026-11-19T10:00:00Z', ...insight }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <I18nProvider locale="en">
        <InsightCard apiUrl="http://api.test" />
      </I18nProvider>,
    );
  });
}

const buttons = () => [...document.body.querySelectorAll('button')].map((b) => b.textContent);
const LIVE_NOTE = 'Your profile keeps the insight it shows until you show this new text.';

describe('the insight card while a newer draft waits behind a shown insight (ruling 889)', () => {
  it('says the shown insight stays, and offers both Show and Make private', async () => {
    await open({ status: 'draft', publishedAt: '2026-11-18T10:00:00Z' });

    expect(document.body.textContent).toContain(LIVE_NOTE);
    expect(buttons()).toEqual(
      expect.arrayContaining(['Show on my public profile', 'Make private']),
    );
  });

  it('a draft with nothing shown: Show only, no note', async () => {
    await open({ status: 'draft', publishedAt: null });

    expect(document.body.textContent).not.toContain(LIVE_NOTE);
    expect(buttons()).not.toContain('Make private');
  });
});
