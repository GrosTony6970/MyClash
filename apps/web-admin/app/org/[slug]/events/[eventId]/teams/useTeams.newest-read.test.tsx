import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { useTeams } from './useTeams';

/**
 * Two writes on the Teams page, each followed by a read of the list. The first read can land
 * last; its older list must not replace the newer one.
 */
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

type Answer = Awaited<ReturnType<typeof apiRequest>>;
const team = (id: string) => ({ id, name: id, size: 3, seed: null, color: null, logoUrl: null });

/** Each button creates the team it names; the line lists the teams as read. */
function Probe() {
  const teams = useTeams('tt-1');
  return (
    <>
      <output data-testid="probe">{teams.teams.map((x) => x.id).join(',')}</output>
      {['b', 'c'].map((name) => (
        <button key={name} type="button" onClick={() => void teams.create({ name })}>
          {name}
        </button>
      ))}
    </>
  );
}
const press = (name: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent === name)!.click();

let root: Root | undefined;
let container: HTMLElement | undefined;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe('the list of teams read twice at once', () => {
  it('keeps the newest read when the older one lands last', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    let releaseOld!: () => void;
    const reads: Array<() => Promise<Answer>> = [
      async () => ({ ok: true, data: [team('a')] }) as Answer,
      // The read after the first write: held until the second write's read has landed.
      () =>
        new Promise<Answer>((resolve) => {
          releaseOld = () => resolve({ ok: true, data: [team('a'), team('b')] } as Answer);
        }),
      async () => ({ ok: true, data: [team('a'), team('b'), team('c')] }) as Answer,
    ];
    vi.mocked(apiRequest).mockImplementation(async (_base, _path, init) =>
      init?.method ? ({ ok: true, data: {} } as Answer) : reads.shift()!(),
    );
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(<Probe />));
    await settle();
    const probe = () => container!.querySelector('[data-testid="probe"]')!.textContent;
    expect(probe()).toBe('a');

    await act(async () => press('b'));
    await settle();
    await act(async () => press('c'));
    await settle();
    expect(probe()).toBe('a,b,c');

    await act(async () => releaseOld());
    await settle();
    expect(probe()).toBe('a,b,c');
  });
});
