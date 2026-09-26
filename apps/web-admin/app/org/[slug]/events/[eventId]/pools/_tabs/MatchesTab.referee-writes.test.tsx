import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import { MatchesTab } from './MatchesTab';

/**
 * What the Pools page's two referee dropdowns send, and what they show when the one
 * referee checker refuses (ADR-016, W1.2).
 *
 * Both routes take a strict body; a shared hook once sent a key its route refused for
 * months because no test read the body. So each dropdown's BODY is pinned here, as the
 * component builds it. A refusal used to be a console line and a refetch.
 */

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@/lib/supabase-browser', () => ({ useRealtimeWithFallback: () => undefined }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const MATCH = {
  id: 'm-1',
  pool_id: 'pool-1',
  round_number: 1,
  red_registration_id: 'reg-red',
  blue_registration_id: 'reg-blue',
  red_name: 'Ana',
  red_club_abbrev: null,
  blue_name: 'Ben',
  blue_club_abbrev: null,
  red_score: null,
  blue_score: null,
  winner_registration_id: null,
  status: 'scheduled',
  lice_id: null,
  match_number_label: 'L1-P1-M1',
  roundCode: 'LSW-P1-M1',
  referees: [],
};

const READS: Record<string, unknown> = {
  '/api/v1/tournaments/t-1/pools-with-matches': [
    { poolId: 'pool-1', poolName: 'Pool A', matches: [MATCH] },
  ],
  '/api/v1/tournaments/t-1': {},
  '/api/v1/events/ev1/lices': [],
  '/api/v1/events/ev1/referees': [
    {
      personId: 'gp-lea',
      displayName: 'Léa',
      clubLabel: null,
      qualifications: [{ skillId: 'arbitre_declarant', rating: null }],
    },
  ],
  '/api/v1/tournaments/t-1/pool-match-role-config': {
    roles: [{ id: 'arbitre_declarant', displayName: 'Déclarant' }],
  },
};

/** The one checker's amber refusal, as the per-bout door answers it. */
const AMBER = {
  ok: false,
  kind: 'http',
  status: 409,
  code: 'referee_needs_confirmation',
  detail: 'Assigning this referee needs confirmation: own_pool (Longsword · Pool A)',
  details: {
    level: 'discouraged',
    reasons: [
      {
        code: 'own_pool',
        level: 'discouraged',
        against: { kind: 'pool', id: 'pool-1', label: 'Longsword · Pool A' },
        confirmed: false,
      },
    ],
  },
};

let writeAnswers: unknown[] = [];

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  writeAnswers = [];
  vi.mocked(apiRequest).mockReset();
  vi.mocked(apiRequest).mockImplementation(async (_base: string, path: string, init) =>
    init?.method === 'PUT'
      ? ((writeAnswers.shift() ?? { ok: true, data: { skippedMatchIds: [] } }) as never)
      : ({ ok: true, data: READS[path] ?? [] } as never),
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <MatchesTab tournamentId="t-1" poolPhaseId="phase-1" slug="org" eventId="ev1" />
      </I18nProvider>,
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** The dropdowns offering Léa: the Pool strip's first (in the head), the bout's after. */
function refereeSelects(): { pool: HTMLSelectElement; bout: HTMLSelectElement } {
  const withLea = [...container.querySelectorAll('select')].filter((s) =>
    [...s.options].some((o) => o.value === 'gp-lea'),
  );
  const pool = withLea.find((s) => s.closest('thead'));
  const bout = withLea.find((s) => s.closest('tbody'));
  if (!pool || !bout) throw new Error('referee dropdowns not rendered');
  return { pool, bout };
}

async function pick(select: HTMLSelectElement, value: string) {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

const writes = () =>
  vi
    .mocked(apiRequest)
    .mock.calls.filter(([, , init]) => init?.method === 'PUT')
    .map(([, path, init]) => [path, init?.body]);

describe('the Pools page referee dropdowns', () => {
  it('a bout sends its role and referee to the per-bout door', async () => {
    await pick(refereeSelects().bout, 'gp-lea');
    expect(writes()).toStrictEqual([
      [
        '/api/v1/matches/m-1/referee-role-assignments',
        { role: 'arbitre_declarant', refereeId: 'gp-lea' },
      ],
    ]);
  });

  it('the Pool strip sends its role and referee to the per-Pool door', async () => {
    await pick(refereeSelects().pool, 'gp-lea');
    expect(writes()).toStrictEqual([
      [
        '/api/v1/pools/pool-1/referee-role-assignments',
        { role: 'arbitre_declarant', refereeId: 'gp-lea' },
      ],
    ]);
  });

  it('says how many bouts the Pool strip left with their referee', async () => {
    writeAnswers = [{ ok: true, data: { skippedMatchIds: ['m-1'] } }];
    await pick(refereeSelects().pool, 'gp-lea');
    expect(container.textContent).toContain(
      'Bouts kept with their current referee, because this referee fights in them: 1',
    );
  });

  it('shows an amber refusal, and "Assign anyway" confirms the same pick', async () => {
    writeAnswers = [AMBER];
    await pick(refereeSelects().bout, 'gp-lea');
    expect(container.textContent).toContain('fights in this Pool (Longsword · Pool A)');

    const anyway = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Assign anyway',
    );
    await act(async () => anyway?.click());

    expect(writes().map(([, body]) => body)).toStrictEqual([
      { role: 'arbitre_declarant', refereeId: 'gp-lea' },
      { role: 'arbitre_declarant', refereeId: 'gp-lea', confirm: true },
    ]);
    // The confirmed pick stays: it was not undone while the organiser decided.
    expect(refereeSelects().bout.value).toBe('gp-lea');
  });

  it('Cancel on an amber refusal puts the bout back as it was', async () => {
    writeAnswers = [AMBER];
    await pick(refereeSelects().bout, 'gp-lea');
    expect(refereeSelects().bout.value).toBe('gp-lea');

    const cancel = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Cancel',
    );
    await act(async () => cancel?.click());

    expect(refereeSelects().bout.value).toBe('');
    expect(writes()).toHaveLength(1);
  });
});
