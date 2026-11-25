import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import type { PoolStandingsRow } from '@myclash/types/pool-standings';
import { I18nProvider } from '@/i18n/I18nProvider';
import { StandingsTab } from './StandingsTab';

/**
 * A team Pool's standings: each row is named by its team (the API's `sideLabel`) and carries
 * the team's colour chip. A Fighter's row has no colour, so no chip.
 */
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@/lib/supabase-browser', () => ({ useRealtimeWithFallback: () => undefined }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const row = (over: Partial<PoolStandingsRow>): PoolStandingsRow =>
  ({
    rank: 1,
    entrantId: 'team-lyon',
    displayName: 'Lyon Blades',
    club: null,
    status: 'in_progress',
    stats: { W: 2 },
    kind: 'team',
    colour: 'red',
    logoUrl: null,
    ...over,
  }) as PoolStandingsRow;

const OVERALL = {
  rulesetCode: 'TF_v1',
  rulesetVersion: '1.0.0',
  columns: [{ key: 'W', label: 'Wins', type: 'int', sortDesc: true }],
  rows: [
    row({}),
    row({
      rank: 2,
      entrantId: 'reg-anna',
      displayName: 'Anna Roux',
      kind: 'individual',
      colour: null,
    }),
  ],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(apiRequest).mockReset();
  vi.mocked(apiRequest).mockImplementation(async (_base: string, path: string) =>
    path.includes('pool-standings')
      ? ({ ok: true, data: OVERALL } as never)
      : ({ ok: true, data: {} } as never),
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <StandingsTab tournamentId="t-1" poolPhaseId="ph-1" />
      </I18nProvider>,
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** The name cell of the row that names `name`. */
function nameCell(name: string): HTMLTableCellElement {
  const cell = [...container.querySelectorAll('tbody td')].find((td) =>
    td.textContent?.includes(name),
  );
  if (!cell) throw new Error(`no row names ${name}`);
  return cell as HTMLTableCellElement;
}

describe('the standings of a team Pool', () => {
  it('names the team and shows its colour chip', () => {
    const chip = nameCell('Lyon Blades').querySelector('span.rounded-full');
    expect(chip).not.toBeNull();
  });

  it('shows no chip on a Fighter row', () => {
    expect(nameCell('Anna Roux').querySelector('span.rounded-full')).toBeNull();
  });
});
