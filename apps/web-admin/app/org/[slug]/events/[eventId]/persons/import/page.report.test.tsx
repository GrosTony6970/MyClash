import type { ReactNode } from 'react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import type { CsvImportReport, ImportPreviewResponse } from '@myclash/types';
import { EVENT_ID, openEventPage, type OpenedPage } from '../../archived-page.fixtures';
import CsvImportPage from './page';

/**
 * What the roster import tells the organiser about each row it will not import (O17, ruled
 * 2026-10-14): the row's line in HER file (the header is line 1), and why, in her language.
 * The preview and the last screen both list them. The preview used to print one less than
 * the line, hid the skipped rows, and the last screen only counted.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'org', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/org/events/ev1/persons/import',
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

const PREVIEW: ImportPreviewResponse = {
  summary: { toCreate: 1, toLink: 0, duplicates: 1, invalid: 1 },
  newClubs: [],
  unknownColumns: ['prenom2', 'Arbitre'],
  rows: [
    {
      index: 2,
      line: 6,
      givenName: '',
      familyName: '',
      status: 'invalid',
      reason: 'invalid_email',
      value: 'tom@',
      defaultAction: 'create_new',
    },
    {
      index: 0,
      line: 2,
      givenName: 'Léa',
      familyName: 'Martin',
      status: 'duplicate',
      reason: 'already_on_roster',
      defaultAction: 'create_new',
    },
    {
      index: 1,
      line: 4,
      givenName: 'Paul',
      familyName: 'Petit',
      status: 'ok',
      defaultAction: 'create_new',
    },
  ],
};

const REPORT: CsvImportReport = {
  created: 1,
  duplicates: [{ line: 2, name: 'Léa Martin', reason: 'already_on_roster', existingEmail: null }],
  invalid: [{ line: 6, reason: 'invalid_email', value: 'tom@', raw: 'Tom,Roux,tom@' }],
  newClubsForReview: [],
  unmatchableIdentities: [],
};

const BASE = `/api/v1/events/${EVENT_ID}/persons/import`;
let page: OpenedPage;
afterEach(() => page.unmount());

const text = () => document.body.textContent ?? '';
const button = (testId: string) =>
  document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!;

async function previewed(): Promise<void> {
  page = await openEventPage(
    <CsvImportPage />,
    { [`/api/v1/events/${EVENT_ID}`]: { id: EVENT_ID, name: 'Open', status: 'published' } },
    { [`POST ${BASE}/preview`]: PREVIEW, [`POST ${BASE}`]: REPORT },
  );
  const input = document.querySelector<HTMLInputElement>('[data-testid="import-file-input"]')!;
  const file = new File(['given_name,family_name\n'], 'roster.csv', { type: 'text/csv' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  await act(async () => button('import-validate').click());
  await page.settle();
}

describe('the rows the roster import will not take', () => {
  it('shows each row at its line in the file, and lists the skipped ones with why', async () => {
    await previewed();
    expect(text()).toContain('Line 4:');
    expect(text()).not.toContain('Line 3:');
    expect(text()).toContain('Line 2: Léa Martin · Already on the roster.');
    expect(text()).toContain('Line 6: This email is not valid: tom@');
  });

  // O18: a header the import does not read is named, as the file writes it.
  it('names the columns of the file this import does not read', async () => {
    await previewed();
    expect(document.querySelector('[role="note"]')?.textContent).toBe(
      'Columns this import does not read: prenom2, Arbitre',
    );
  });

  it('offers the template of the page language', async () => {
    page = await openEventPage(<CsvImportPage />, {
      [`/api/v1/events/${EVENT_ID}`]: { id: EVENT_ID, name: 'Open', status: 'published' },
    });
    const link = [...document.querySelectorAll('a')].find(
      (a) => a.textContent === 'Download template',
    );
    expect(link?.getAttribute('href')).toBe('/csv-samples/participants-en.csv');
    expect(link?.hasAttribute('download')).toBe(true);
  });

  it('lists each skipped and refused row on the last screen, with no "updated"', async () => {
    await previewed();
    await act(async () => button('import-commit').click());
    await page.settle();
    expect(text()).toContain('1 created · 1 skipped · 1 invalid');
    expect(text()).toContain('Skipped rows');
    expect(text()).toContain('Line 2: Léa Martin · Already on the roster.');
    expect(text()).toContain('Rows not imported');
    expect(text()).toContain('Line 6: This email is not valid: tom@');
    expect(text()).not.toContain('updated');
  });
});
