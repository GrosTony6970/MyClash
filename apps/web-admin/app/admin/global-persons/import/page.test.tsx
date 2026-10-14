import type { ReactNode } from 'react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import {
  openEventPage,
  type OpenedPage,
} from '../../../org/[slug]/events/[eventId]/archived-page.fixtures';
import GlobalPersonsImportPage from './page';

/**
 * The super admin's Global Profiles import words each refused row from the server's code
 * (O17), as the roster import does: it used to print the server's English sentences, and a
 * database refusal word for word.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({}),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/admin/global-persons/import',
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

const FIELDS = {
  givenName: 'Ada',
  familyName: 'Lovelace',
  displayName: 'Ada Lovelace',
  hemaRatingsId: null,
  email: null,
  dateOfBirth: null,
  clubLabel: null,
  clubAbbreviation: null,
  clubCity: null,
  genderCategory: null,
  weapons: null,
  isFighter: true,
  isReferee: false,
  isWorkshopParticipant: false,
};
const PREVIEW = {
  summary: { total: 2, ok: 1, invalid: 1, duplicate: 0 },
  unknownColumns: ['notes'],
  rows: [
    { index: 3, status: 'ok', problem: null, duplicate: null, raw: '', fields: FIELDS },
    {
      index: 5,
      status: 'invalid',
      problem: { reason: 'invalid_email', value: 'bob@' },
      duplicate: null,
      raw: 'Bob,Jones,bob@',
      fields: { ...FIELDS, givenName: '', familyName: '', displayName: '' },
    },
  ],
};
const REPORT = {
  created: 0,
  updated: 0,
  skipped: 1,
  failed: [{ index: 3, reason: 'not_saved' }],
  newClubs: [],
};

let page: OpenedPage;
afterEach(() => page.unmount());

const text = () => document.body.textContent ?? '';
const press = async (label: string) => {
  const target = [...document.querySelectorAll('button')].find((b) =>
    b.textContent?.startsWith(label),
  );
  await act(async () => target!.click());
  await page.settle();
};

describe('the Global Profiles import', () => {
  it("words the server's code for a refused row, in the preview and in the report", async () => {
    page = await openEventPage(
      <GlobalPersonsImportPage />,
      {},
      {
        'POST /api/v1/global-persons/import/preview': PREVIEW,
        'POST /api/v1/global-persons/import': REPORT,
      },
    );
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(['given_name\n'], 'people.csv', { type: 'text/csv' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    await press('Preview');
    expect(text()).toContain('This email is not valid: bob@');
    // O18: the Global Profiles import reads no notes, and says so.
    expect(document.querySelector('[role="note"]')?.textContent).toBe(
      'Columns this import does not read: notes',
    );

    await press('Commit');
    expect(text()).toContain('Line 3: Not saved: the server refused this row.');
  });
});
