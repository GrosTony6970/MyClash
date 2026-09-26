import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import { RefereeWriteNotice } from '@/components/RefereeRefusalNotice';
import { useRefereeWrite, type RefereeWrite } from './useRefereeWrite';

/**
 * A referee write on a screen with no picker (the Pools page's dropdowns): the one
 * checker's refusal is SHOWN, and an amber one is confirmed by sending the same body again
 * with `confirm: true`. Before, the pick snapped back with a console line.
 */

vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const PATH = '/api/v1/matches/m-1/referee-role-assignments';
const BODY = { role: 'arbitre_declarant', refereeId: 'gp-lea' };
const OWN_POOL = {
  code: 'own_pool',
  level: 'discouraged',
  against: { kind: 'pool', id: 'pool-a', label: 'Longsword · Pool A' },
  confirmed: false,
};

const refused = (code: string, level: string) => ({
  ok: false,
  kind: 'http',
  status: 409,
  code,
  detail: 'refused',
  details: { level, reasons: [{ ...OWN_POOL, level }] },
});

let write: RefereeWrite;
function Probe() {
  const w = useRefereeWrite();
  useEffect(() => {
    write = w;
  });
  return <RefereeWriteNotice write={w} />;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(apiRequest).mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <Probe />
      </I18nProvider>,
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const bodies = () => vi.mocked(apiRequest).mock.calls.map(([, , init]) => init?.body);
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === label);

describe('useRefereeWrite', () => {
  it('sends the body as given, and hands the answer to `after`', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ ok: true, data: { skippedMatchIds: [] } } as never);
    const after = vi.fn();

    await act(async () => write.put(PATH, BODY, after));

    expect(vi.mocked(apiRequest).mock.calls[0]?.[1]).toBe(PATH);
    expect(vi.mocked(apiRequest).mock.calls[0]?.[2]?.method).toBe('PUT');
    expect(bodies()).toStrictEqual([BODY]);
    expect(after).toHaveBeenCalledWith({ skippedMatchIds: [] });
  });

  it('shows an amber refusal, and "Assign anyway" sends the same body with confirm', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(refused('referee_needs_confirmation', 'discouraged') as never)
      .mockResolvedValueOnce({ ok: true, data: {} } as never);
    const after = vi.fn();

    await act(async () => write.put(PATH, BODY, after));
    // The pick stays on screen while the organiser decides.
    expect(after).not.toHaveBeenCalled();
    expect(container.textContent).toContain('This referee needs your confirmation:');
    expect(container.textContent).toContain('fights in this Pool (Longsword · Pool A)');

    await act(async () => button('Assign anyway')?.click());

    expect(bodies()).toStrictEqual([BODY, { ...BODY, confirm: true }]);
    expect(after).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenLastCalledWith({});
    expect(container.textContent).not.toContain('needs your confirmation');
  });

  it('Cancel on an amber refusal undoes the pick', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce(
      refused('referee_needs_confirmation', 'discouraged') as never,
    );
    const after = vi.fn();

    await act(async () => write.put(PATH, BODY, after));
    await act(async () => button('Cancel')?.click());

    expect(after).toHaveBeenCalledWith(null);
    expect(bodies()).toHaveLength(1);
  });

  it('a red refusal offers no "Assign anyway"', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce(
      refused('referee_impossible', 'impossible') as never,
    );

    const after = vi.fn();
    await act(async () => write.put(PATH, BODY, after));

    // Nothing to decide: the pick is undone at once.
    expect(after).toHaveBeenCalledWith(null);
    expect(container.textContent).toContain('This referee cannot take it:');
    expect(button('Assign anyway')).toBeUndefined();
    expect(button('Cancel')).toBeDefined();
  });

  it("says a locked board in the organiser's language, never only in the console", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({
      ok: false,
      kind: 'http',
      status: 409,
      code: 'referee_board_locked',
      detail: 'Referee assignments are locked. Unlock them before changing a referee.',
      details: null,
    } as never);
    const after = vi.fn();

    await act(async () => write.put(PATH, BODY, after));

    expect(after).toHaveBeenCalledWith(null);
    expect(container.textContent).toBe(
      'Referee assignments are locked. Unlock them on the Referees page first.',
    );
  });

  it("says any other failure in the API's own words", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({
      ok: false,
      kind: 'http',
      status: 400,
      code: 'bad_request',
      detail: 'Selected referee is not qualified for this role',
      details: null,
    } as never);

    await act(async () => write.put(PATH, BODY, vi.fn()));

    expect(container.textContent).toBe('Selected referee is not qualified for this role');
  });

  it('shows the note `after` returns', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ ok: true, data: {} } as never);
    await act(async () => write.put(PATH, BODY, () => 'Two bouts kept'));
    expect(container.textContent).toContain('Two bouts kept');
  });
});
