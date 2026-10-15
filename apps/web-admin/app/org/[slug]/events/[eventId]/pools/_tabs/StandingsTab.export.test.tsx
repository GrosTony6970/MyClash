import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { fr } from '@myclash/i18n';
import { I18nProvider } from '@/i18n/I18nProvider';
import { StandingsTab } from './StandingsTab';

/**
 * The Pool standings file (O20): a French organiser opens it in Excel and reads "Géraldine",
 * French column titles, the stat's own word and the Pool's state in words.
 */
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@/lib/supabase-browser', () => ({ useRealtimeWithFallback: () => undefined }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const OVERALL = {
  rulesetCode: 'TF_v1',
  rulesetVersion: '1.0.0',
  columns: [{ key: 'W', label: 'Wins', type: 'int', sortDesc: true }],
  rows: [
    {
      rank: 1,
      registrationId: 'r-1',
      displayName: 'Géraldine Roux',
      club: { id: 'c-1', name: 'Lyon Escrime', abbreviation: 'LYE' },
      status: 'in_progress',
      stats: { W: 3 },
    },
  ],
};

let container: HTMLDivElement;
let root: Root;
const blobs: Blob[] = [];

beforeEach(async () => {
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
      <I18nProvider locale="fr">
        <StandingsTab tournamentId="t-1" poolPhaseId="ph-1" />
      </I18nProvider>,
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Export CSV, then the file of `choice` in its menu; the file's lines. */
async function exportAs(choice: string): Promise<string[]> {
  const exportButton = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === `${fr.organizer.pools.standings.exportCsv} ▾`,
  );
  await act(async () => exportButton!.click());
  const item = [...container.querySelectorAll('[role="menuitem"]')].find((button) =>
    button.textContent!.startsWith(choice),
  ) as HTMLButtonElement;
  await act(async () => item.click());

  const bytes = new Uint8Array(await blobs[0]!.arrayBuffer());
  expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  return new TextDecoder().decode(bytes.slice(3)).split('\r\n');
}

describe('the Pool standings file', () => {
  it('is in the reader’s language, with the byte-order mark', async () => {
    const lines = await exportAs(fr.organizer.csvExport.standard);
    expect(lines[0]).toBe('Rang,Combattant,Club,Victoires,Statut');
    expect(lines[1]).toBe('1,Géraldine Roux,Lyon Escrime,3,En cours');
  });

  it('is split by ; for French Excel, when that is picked', async () => {
    const lines = await exportAs(fr.organizer.csvExport.excelFrench);
    expect(lines[0]).toBe('Rang;Combattant;Club;Victoires;Statut');
    expect(lines[1]).toBe('1;Géraldine Roux;Lyon Escrime;3;En cours');
  });

  it('titles the stat column on screen with the same word', () => {
    expect(container.textContent).toContain('Victoires');
    expect(container.textContent).not.toContain('Wins');
  });
});
