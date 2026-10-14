import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { FAILED_READ, openEventPage, type OpenedPage } from '../archived-page.fixtures';
import PrintPackPage from './page';

/**
 * O22 (ruled 2026-10-14): "All Tournaments" joins each Tournament's pack in ONE print job,
 * with no new layout. Before, an Event of four Tournaments was four print jobs at 8 a.m.
 */

const NAVIGATION = vi.hoisted(() => ({
  search: new URLSearchParams(),
  router: { replace: () => undefined, push: () => undefined },
}));
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'club', eventId: 'ev1' }),
  useRouter: () => NAVIGATION.router,
  usePathname: () => '/org/club/events/ev1/print',
  useSearchParams: () => NAVIGATION.search,
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

const pool = (poolName: string, red: string, blue: string) => ({
  poolId: `pool-${poolName}`,
  poolName,
  matches: [
    {
      id: `m-${poolName}`,
      round_number: 1,
      red_name: red,
      blue_name: blue,
      red_club_abbrev: null,
      blue_club_abbrev: null,
      red_registration_id: `r-${red}`,
      blue_registration_id: `r-${blue}`,
      lice_id: null,
      scheduled_at: null,
      roundCode: `${poolName}-M1`,
      referees: [],
    },
  ],
});

const tournamentReads = (id: string, name: string, pools: unknown[]) => ({
  [`/api/v1/tournaments/${id}`]: { name, ruleset_code: 'TF_v1', ruleset_version: '1.0.0' },
  [`/api/v1/tournaments/${id}/pools-with-matches`]: pools,
  // No bracket phase: the server answers 404, which this page reads as "pools only".
  [`/api/v1/tournaments/${id}/bracket`]: FAILED_READ,
});

const READS = {
  '/api/v1/events/ev1': {
    id: 'ev1',
    name: 'Open 2026',
    status: 'running',
    timezone: 'Europe/Paris',
  },
  '/api/v1/events/ev1/tournaments': [
    { id: 't-1', name: 'Longsword' },
    { id: 't-2', name: 'Sabre' },
    { id: 't-3', name: 'Rapier' },
  ],
  '/api/v1/events/ev1/lices': [],
  ...tournamentReads('t-1', 'Longsword', [pool('Pool L', 'Ana Roux', 'Bo Lund')]),
  ...tournamentReads('t-2', 'Sabre', [pool('Pool S', 'Cy Morel', 'Di Vidal')]),
  // A Tournament with no bout yet has nothing to print: it is left out, not a blank sheet.
  ...tournamentReads('t-3', 'Rapier', []),
};

/** The documents the page handed to a print window. */
function printWindowCatches(): string[] {
  const written: string[] = [];
  vi.spyOn(window, 'open').mockReturnValue({
    document: { write: (html: string) => written.push(html), close: () => undefined },
    focus: () => undefined,
    print: () => undefined,
  } as unknown as Window);
  return written;
}

async function pressPrint() {
  const print = [...document.body.querySelectorAll('button')].find(
    (button) => button.textContent === 'Print',
  );
  expect(print?.disabled, 'Print is closed').toBe(false);
  await act(async () => print!.click());
}

let page: OpenedPage;
afterEach(() => {
  page.unmount();
  vi.restoreAllMocks();
});

describe('the print pack of every Tournament', () => {
  it('prints the packs of every Tournament with bouts in one document', async () => {
    NAVIGATION.search = new URLSearchParams('tournamentId=all');
    page = await openEventPage(<PrintPackPage />, READS);
    const written = printWindowCatches();

    await pressPrint();

    expect(written).toHaveLength(1);
    const html = written[0]!;
    expect(html.match(/<!doctype html>/gi)).toHaveLength(1);
    expect(html).toContain('<title>Open 2026</title>');
    expect(html.indexOf('Pool L')).toBeGreaterThan(0);
    expect(html.indexOf('Pool L')).toBeLessThan(html.indexOf('Pool S'));
    expect(html).not.toContain('Rapier');
  });

  it('still prints one Tournament alone, under its own name', async () => {
    NAVIGATION.search = new URLSearchParams('tournamentId=t-2');
    page = await openEventPage(<PrintPackPage />, READS);
    const written = printWindowCatches();

    await pressPrint();

    expect(written[0]).toContain('<title>Sabre — Open 2026</title>');
    expect(written[0]).not.toContain('Pool L');
  });
});
