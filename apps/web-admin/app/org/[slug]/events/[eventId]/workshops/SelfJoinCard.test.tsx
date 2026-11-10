import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import { SelfJoinCard } from './SelfJoinCard';

/**
 * The join switch of ruling 516 on the Workshops page. The stand-in server keeps the stored value:
 * a taken save changes it, a refused one does not, and the switch then goes back.
 */
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const REFUSED = {
  ok: false as const,
  kind: 'unauthenticated' as const,
  status: 403 as const,
  detail: 'Requires admin role or higher',
  code: null,
  details: null,
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

function standInServer(stored: boolean, takesSave: boolean) {
  const saves: unknown[] = [];
  vi.mocked(apiRequest).mockReset();
  vi.mocked(apiRequest).mockImplementation(async (_base, path, init) => {
    if (path !== '/api/v1/events/ev-1') throw new Error(`unexpected request ${path}`);
    if (init?.method === 'PATCH') {
      saves.push(init.body);
      return (takesSave ? { ok: true, data: {} } : REFUSED) as never;
    }
    return { ok: true, data: { id: 'ev-1', workshop_self_join: stored } } as never;
  });
  return saves;
}

async function open(readOnly = false) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <I18nProvider locale="en">
        <SelfJoinCard apiUrl="http://api.test" eventId="ev-1" readOnly={readOnly} />
      </I18nProvider>,
    );
  });
}

const theSwitch = () => document.body.querySelector<HTMLButtonElement>('[role="switch"]')!;
const press = async () => {
  await act(async () => theSwitch().click());
};

describe('the join switch on the Workshops page (ruling 516)', () => {
  it("shows the Event's stored value", async () => {
    standInServer(true, true);
    await open();
    expect(theSwitch().getAttribute('aria-checked')).toBe('true');
    expect(document.body.textContent).toContain('People may join this Event by themselves');
  });

  it('saves the new value as workshopSelfJoin', async () => {
    const saves = standInServer(false, true);
    await open();
    await press();
    expect(saves).toEqual([{ workshopSelfJoin: true }]);
    expect(theSwitch().getAttribute('aria-checked')).toBe('true');
  });

  it('goes back and says why when the save is refused', async () => {
    const saves = standInServer(false, false);
    await open();
    await press();
    expect(saves).toEqual([{ workshopSelfJoin: true }]);
    expect(theSwitch().getAttribute('aria-checked')).toBe('false');
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBeTruthy();
  });

  it('cannot be changed on a read-only Event', async () => {
    standInServer(false, true);
    await open(true);
    expect(theSwitch().disabled).toBe(true);
  });
});
