import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as ApiClient from '@myclash/api-client';
import { type } from '../../../archived-page.fixtures';
import { control } from './page.rules.fixtures';
import {
  audited,
  CAP_CHANGE,
  confirmWith,
  needsAudit,
  openRules,
  pressButton,
  STARTED_ROW,
  TOURNAMENT,
  type OpenedRules,
} from './page.rules-change.fixtures';

/**
 * The drift banner reads again after a save of the rules (the audited settings change, revision
 * 9 fold 10, revision 10 fold 7): a save writes the fingerprint, so a banner read once at mount
 * would stay on until a reload.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'org', eventId: 'ev1', tournamentId: 't-1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/org/events/ev1/tournaments/t-1/settings',
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

type Answer = Awaited<ReturnType<typeof ApiClient.apiRequest>>;

let opened: OpenedRules;
afterEach(() => opened.page.unmount());

const BANNER = 'The effective rules changed since they were last saved';
const shown = () => document.body.textContent?.includes(BANNER) ?? false;

/** Opens Match format with the banner on; every later drift read answers `later`. */
async function openDrifted(later: Answer = { ok: true, data: { drifted: false } } as Answer) {
  opened = await openRules('match-format');
  const answer = vi.mocked(ApiClient.apiRequest).getMockImplementation()!;
  vi.mocked(ApiClient.apiRequest).mockImplementation(async (base, path, init) =>
    path === `${TOURNAMENT}/ruleset-drift` ? later : answer(base, path, init),
  );
  expect(shown()).toBe(true);
}

describe('the drift banner after a rules save', () => {
  it('reads again after a plain save, and goes when the drift is gone', async () => {
    await openDrifted();
    await act(async () => type(control('Pool match time'), '120'));
    await pressButton(opened, 'Save changes');
    expect(shown()).toBe(false);
  });

  it('stays when that read fails: it is the trace of a drift still there', async () => {
    await openDrifted({ ok: false, kind: 'network' } as Answer);
    await act(async () => type(control('Pool match time'), '120'));
    await pressButton(opened, 'Save changes');
    expect(shown()).toBe(true);
  });

  it('reads again after an audited save', async () => {
    await openDrifted();
    opened.patches.push(needsAudit([CAP_CHANGE]), audited(STARTED_ROW));
    await act(async () => type(control('Point cap'), '9'));
    await pressButton(opened, 'Save changes');
    await confirmWith(opened);
    expect(shown()).toBe(false);
  });
});
