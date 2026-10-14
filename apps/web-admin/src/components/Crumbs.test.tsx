import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import {
  EVENT_ID,
  openEventPage,
  type OpenedPage,
} from '../../app/org/[slug]/events/[eventId]/archived-page.fixtures';
import { EventCrumb, OrgCrumb } from './Crumbs';

/**
 * The trail at the head of an organiser's page showed the club's slug (`lyon-hema`) and
 * the word "Event" on sixteen pages (quick win X3). The shell already reads both names.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'club', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/club/events/ev1',
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

let page: OpenedPage;
afterEach(() => page.unmount());

const links = () =>
  [...document.body.querySelectorAll('a')].map((a) => [a.getAttribute('href'), a.textContent]);

describe('the crumbs', () => {
  it('name the club and the Event, linking to each', async () => {
    page = await openEventPage(
      <>
        <OrgCrumb slug="club" />
        <EventCrumb slug="club" eventId={EVENT_ID} fallback="Event" />
      </>,
      { [`/api/v1/events/${EVENT_ID}`]: { id: EVENT_ID, name: 'Open 2026', status: 'running' } },
    );
    expect(links()).toEqual([
      ['/org/club', 'Club'],
      ['/org/club/events/ev1', 'Open 2026'],
    ]);
  });

  it('show the slug and the page word until the names have landed', async () => {
    page = await openEventPage(
      <>
        <OrgCrumb slug="club" />
        <EventCrumb slug="club" eventId="ev-unknown" fallback="Event" />
      </>,
      {},
    );
    expect(links()[1]).toEqual(['/org/club/events/ev-unknown', 'Event']);
  });
});

/** Every page file under `app/org`, for the sweep. */
function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pages(path);
    return name.endsWith('.tsx') && !name.includes('.test.') ? [path] : [];
  });
}

describe('the sweep', () => {
  it('finds no crumb that shows the club slug as its words', () => {
    const root = join(__dirname, '../../app/org');
    const slugCrumb = /<Link href=\{`\/org\/\$\{slug\}`\}[^>]*>\s*\{slug\}\s*<\/Link>/;
    const offenders = pages(root).filter((path) => slugCrumb.test(readFileSync(path, 'utf8')));
    expect(offenders.map((path) => relative(root, path))).toEqual([]);
  });
});
