import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { en, fr } from '@myclash/i18n';
import type { PoolStandingsRow } from '@myclash/types/pool-standings';
import { I18nProvider } from '@/i18n/I18nProvider';
import { StandingsTab } from './StandingsTab';

/**
 * A team Pool's standings name their entrants "Team", not "Fighter": the column, the filter and
 * the file's column, in the reader's language. A Pool of Fighters keeps "Fighter"
 * (StandingsTab.export.test.tsx).
 */
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@/lib/supabase-browser', () => ({ useRealtimeWithFallback: () => undefined }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const teamRow = (rank: number, id: string, name: string): PoolStandingsRow =>
  ({
    rank,
    entrantId: id,
    displayName: name,
    club: null,
    status: 'in_progress',
    stats: { W: 3 - rank },
    kind: 'team',
    colour: 'red',
    logoUrl: null,
  }) as PoolStandingsRow;

const OVERALL = {
  rulesetCode: 'TF_v1',
  rulesetVersion: '1.0.0',
  columns: [{ key: 'W', label: 'Wins', type: 'int', sortDesc: true }],
  rows: [teamRow(1, 'team-lyon', 'Lyon Blades'), teamRow(2, 'team-paris', 'Paris Rapiers')],
};

/** A team Tournament's Pools, none of which seats anybody yet: no row to read a kind from. */
const EMPTY_BY_POOL = {
  rulesetCode: 'TF_v1',
  rulesetVersion: '1.0.0',
  columns: OVERALL.columns,
  pools: [{ poolId: 'p-1', poolName: 'Pool A', status: 'in_progress', rows: [] }],
};

let container: HTMLDivElement;
let root: Root;
const blobs: Blob[] = [];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  blobs.length = 0;
  vi.stubGlobal('URL', {
    createObjectURL: (blob: Blob) => {
      blobs.push(blob);
      return 'blob:standings';
    },
    revokeObjectURL: () => undefined,
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  vi.mocked(apiRequest).mockReset();
  vi.mocked(apiRequest).mockImplementation(async (_base: string, path: string) => {
    if (path.includes('mode=by-pool')) return { ok: true, data: EMPTY_BY_POOL } as never;
    return path.includes('pool-standings')
      ? ({ ok: true, data: OVERALL } as never)
      : ({ ok: true, data: {} } as never);
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.location.hash = '';
});

async function open(locale: 'en' | 'fr') {
  await act(async () => {
    root.render(
      <I18nProvider locale={locale}>
        <StandingsTab tournamentId="t-1" poolPhaseId="ph-1" teams />
      </I18nProvider>,
    );
  });
}

/** Opens the export menu named `label`, picks the standard file, and reads the file's text. */
async function exportFile(label: string) {
  const exportButton = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === `${label} ▾`,
  );
  await act(async () => exportButton!.click());
  const item = [...container.querySelectorAll('[role="menuitem"]')].find((button) =>
    button.textContent!.startsWith(fr.common.csvExport.standard),
  ) as HTMLButtonElement;
  await act(async () => item.click());
  return new TextDecoder().decode(new Uint8Array(await blobs[0]!.arrayBuffer()).slice(3));
}

/** The header cells' text, the filter's label, its placeholder. */
const headers = () => [...container.querySelectorAll('thead th')].map((th) => th.textContent);
const filter = () => container.querySelector('input')!;

describe('the standings words of a team Pool', () => {
  for (const [locale, words] of [
    ['en', en],
    ['fr', fr],
  ] as const) {
    it(`say "${words.organizer.pools.standings.team}" in ${locale}`, async () => {
      await open(locale);
      const standings = words.organizer.pools.standings;
      expect(headers().some((h) => h?.startsWith(standings.team))).toBe(true);
      expect(headers().some((h) => h?.startsWith(standings.fighter))).toBe(false);
      expect(filter().getAttribute('aria-label')).toBe(standings.searchTeam);
      expect(filter().placeholder).toBe(standings.searchTeam);
    });
  }

  // A team has no club: an always-empty Club column would say nothing.
  it('head the file’s column "Équipe" for a French organiser, with no Club column', async () => {
    await open('fr');
    const lines = (await exportFile(fr.organizer.pools.standings.exportCsv)).split('\r\n');
    expect(lines[0]).toBe('Rang,Équipe,Victoires,Statut');
    expect(lines[1]).toBe('1,Lyon Blades,2,En cours');
    expect(lines[2]).toBe('2,Paris Rapiers,1,En cours');
  });

  // The Tournament's kind says it: no row of an empty Pool is there to.
  it('head the file of Pools that seat nobody yet "Équipe", with no Club column', async () => {
    window.location.hash = '#standings-by-pool';
    await open('fr');
    const text = await exportFile(fr.organizer.pools.standings.exportAllPools);
    expect(text.split('\r\n')[0]).toBe('Rang,Équipe,Poule,Victoires,Statut');
  });
});
