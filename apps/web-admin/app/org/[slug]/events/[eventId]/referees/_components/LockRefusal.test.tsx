import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import { lockRefusal } from '@/lib/referee-reasons';
import { LockRefusal } from './LockRefusal';
import { requestLock } from './lock-assignments';

/**
 * Locking the referee board tells every referee their duty (ADR-019). The API refuses
 * while a duty breaks a rule with no override; the organiser reassigns, or sends anyway.
 * The lock was sent with no body; the body is pinned here, both ways.
 */

vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const MARC = {
  assignmentId: 'ra-1',
  personId: 'gp-marc',
  personName: 'Marc',
  unitId: 'pool-a',
  unitName: 'Longsword · Pool A',
  tournamentId: 't-1',
  role: 'arbitre_declarant',
  start: null,
  level: 'impossible' as const,
  reasons: [
    {
      code: 'fights_overlap' as const,
      level: 'impossible' as const,
      against: { kind: 'match' as const, id: 'm-9', label: 'Longsword · Pool B' },
      confirmed: false,
    },
  ],
};

describe('the lock request', () => {
  beforeEach(() => {
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockResolvedValue({ ok: true, data: {} } as never);
  });

  it.each([
    [false, {}],
    [true, { confirm: true }],
  ])('confirm=%s posts %j', async (confirm, body) => {
    await requestLock('ev1', confirm);
    expect(vi.mocked(apiRequest).mock.calls[0]?.slice(1)).toStrictEqual([
      '/api/v1/events/ev1/lock-referee-assignments',
      { method: 'POST', body },
    ]);
  });
});

describe('lockRefusal', () => {
  it('reads the duties off the lock 409', () => {
    expect(
      lockRefusal({
        kind: 'http',
        status: 409,
        code: 'referee_lock_impossible',
        detail: '1 referee assignment(s) break a rule that has no override',
        details: { conflicts: [MARC] },
        validationErrors: null,
      }),
    ).toStrictEqual([MARC]);
  });

  it('is null for any other failure, a locked board included', () => {
    expect(
      lockRefusal({
        kind: 'http',
        status: 409,
        code: 'referee_board_locked',
        detail: 'locked',
        details: null,
        validationErrors: null,
      }),
    ).toBeNull();
    expect(lockRefusal({ kind: 'network' } as never)).toBeNull();
  });
});

describe('LockRefusal', () => {
  let container: HTMLDivElement;
  let root: Root;
  const onSend = vi.fn();
  const onCancel = vi.fn();

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    onSend.mockReset();
    onCancel.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <I18nProvider locale="en">
          <LockRefusal conflicts={[MARC]} busy={false} onSend={onSend} onCancel={onCancel} />
        </I18nProvider>,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const button = (label: string) =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === label);

  it('names each duty and why, and sends anyway only when asked', async () => {
    expect(container.textContent).toContain('Marc');
    expect(container.textContent).toContain('fights at the same time (Longsword · Pool B)');
    await act(async () => button('Send anyway')?.click());
    expect(onSend).toHaveBeenCalledTimes(1);
    await act(async () => button('Cancel')?.click());
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
