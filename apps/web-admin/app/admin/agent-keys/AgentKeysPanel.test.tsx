import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import {
  openEventPage,
  type OpenedPage,
} from '../../org/[slug]/events/[eventId]/archived-page.fixtures';
import { makePress, rows, text } from '../backups/backups-page.fixtures';
import AdminAgentKeysPage from './page';

/** The ops agent's key on the console (ops agent design, operator guide G8). */
vi.mock('next/navigation', () => ({
  useParams: () => ({}),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/admin/agent-keys',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const LIST = '/api/v1/admin/agent-keys';
const LIVE_ID = '11111111-1111-4111-8111-111111111111';
const OLD_ID = '22222222-2222-4222-8222-222222222222';
const LIVE = {
  id: LIVE_ID,
  label: 'Claude ops agent',
  createdAt: '2026-11-18T10:00:00Z',
  lastUsedAt: null,
  revokedAt: null,
};
const OLD = {
  id: OLD_ID,
  label: 'Claude ops agent',
  createdAt: '2026-11-01T10:00:00Z',
  lastUsedAt: '2026-11-17T08:00:00Z',
  revokedAt: '2026-11-18T09:00:00Z',
};

let page: OpenedPage;
afterEach(() => page.unmount());
const press = makePress(() => page);

describe('the ops agent key screen', () => {
  it('shows each key by label, dates and status, and never its id', async () => {
    page = await openEventPage(<AdminAgentKeysPage />, { [LIST]: [LIVE, OLD] });
    expect(rows()).toHaveLength(2);
    expect(rows()[0]!.textContent).toContain('Claude ops agent');
    expect(rows()[0]!.textContent).toContain('Never');
    expect(rows()[0]!.textContent).toContain('Active');
    expect(rows()[1]!.textContent).toContain('Revoked');
    expect(text()).not.toContain(LIVE_ID);
    expect(text()).not.toContain(OLD_ID);
  });

  it('offers Revoke on the live key only', async () => {
    page = await openEventPage(<AdminAgentKeysPage />, { [LIST]: [LIVE, OLD] });
    const revokeIn = (row: Element) =>
      [...row.querySelectorAll('button')].filter((b) => b.textContent === 'Revoke');
    expect(revokeIn(rows()[0]!)).toHaveLength(1);
    expect(revokeIn(rows()[1]!)).toHaveLength(0);
  });

  it('revokes after the confirmation, and reads the list again', async () => {
    page = await openEventPage(
      <AdminAgentKeysPage />,
      { [LIST]: [LIVE] },
      { [`POST ${LIST}/${LIVE_ID}/revoke`]: { ...LIVE, revokedAt: '2026-11-18T12:00:00Z' } },
    );
    await press('Revoke', rows()[0]!);
    expect(page.writes()).toEqual([]);
    await press('Revoke key');
    expect(page.writes()).toEqual([`POST ${LIST}/${LIVE_ID}/revoke`]);
    expect(text()).toContain('Key revoked.');
  });

  it('says how a key comes to exist when there is none', async () => {
    page = await openEventPage(<AdminAgentKeysPage />, { [LIST]: [] });
    expect(rows()).toHaveLength(0);
    expect(text()).toContain('No key yet.');
  });

  it('speaks French to a French reader', async () => {
    page = await openEventPage(<AdminAgentKeysPage />, { [LIST]: [LIVE] }, {}, { locale: 'fr' });
    expect(rows()[0]!.textContent).toContain('Jamais');
    expect(rows()[0]!.textContent).toContain('Active');
    expect(text()).toContain('Révoquer');
  });
});
