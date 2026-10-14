import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import {
  useAssignmentBoard,
  type AssignAnswer,
  type UseAssignmentBoard,
} from './useAssignmentBoard';

/**
 * What Assign on the pools, bracket and Swiss tabs sends.
 *
 * The route's body is strict and keyed by `personId` (an unclaimed referee has no user
 * id). This hook sent `userId` for months: the route refused every call, and no test read
 * the body, so Assign on those tabs never worked and nothing went red.
 */

vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const BOARD = { pools: [], unscheduledPools: [] };
const MESSAGES = { loadFailed: 'load failed', mutationFailed: 'save failed' };

let hook: UseAssignmentBoard;
function Probe({ expose }: { expose: (board: UseAssignmentBoard) => void }) {
  const board = useAssignmentBoard('ev1', MESSAGES);
  useEffect(() => {
    expose(board);
  });
  return null;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(apiRequest).mockReset();
  vi.mocked(apiRequest).mockImplementation(async (_base: string, path: string) =>
    path.endsWith('/referee-assignment-board') || path.endsWith('/referee-assignments')
      ? { ok: true, data: BOARD }
      : { ok: true, data: [] },
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <Probe expose={(board) => (hook = board)} />
      </I18nProvider>,
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function assignCall() {
  return vi
    .mocked(apiRequest)
    .mock.calls.find(([, path, init]) => path.endsWith('/referee-assignments') && init?.method);
}

describe('useAssignmentBoard.manualAssign', () => {
  it('posts the pool, the role and the person, with no confirmation by default', async () => {
    let answer: AssignAnswer | null = null;
    await act(async () => {
      answer = await hook.manualAssign('pool-1', 'declarant', 'gp-lea');
    });
    expect(answer).toStrictEqual({ assigned: true, refusal: null });
    expect(assignCall()?.[1]).toBe('/api/v1/events/ev1/referee-assignments');
    expect(assignCall()?.[2]?.method).toBe('POST');
    expect(assignCall()?.[2]?.body).toStrictEqual({
      poolId: 'pool-1',
      role: 'declarant',
      personId: 'gp-lea',
    });
  });

  it('answers a refusal with its words, for the picker, and leaves the board line alone (O8)', async () => {
    vi.mocked(apiRequest).mockImplementation(async (_base: string, path: string, init) =>
      init?.method === 'POST'
        ? ({
            ok: false,
            kind: 'http',
            status: 409,
            detail: 'Léa fights at that time',
            validationErrors: null,
            code: null,
            details: null,
          } as never)
        : { ok: true, data: path.endsWith('/referee-assignment-board') ? BOARD : [] },
    );
    let answer: AssignAnswer | null = null;
    await act(async () => {
      answer = await hook.manualAssign('pool-1', 'declarant', 'gp-lea');
    });
    expect(answer).toStrictEqual({ assigned: false, refusal: 'Léa fights at that time' });
    expect(hook.error).toBeNull();
  });

  it('clears an older refusal line once an assignment is saved (review m2)', async () => {
    const served = vi.mocked(apiRequest).getMockImplementation()!;
    vi.mocked(apiRequest).mockImplementation(async (base, path, init) =>
      init?.method === 'DELETE'
        ? ({
            ok: false,
            kind: 'http',
            status: 500,
            detail: null,
            validationErrors: null,
            code: null,
            details: null,
          } as never)
        : served(base, path, init),
    );
    await act(async () => {
      await hook.unassign('ra-1');
    });
    expect(hook.error).toBe('save failed');
    await act(async () => {
      await hook.manualAssign('pool-1', 'declarant', 'gp-lea');
    });
    expect(hook.error).toBeNull();
  });

  it('sends the confirmation when the organiser picks from "Needs confirmation"', async () => {
    await act(async () => {
      await hook.manualAssign('pool-1', 'declarant', 'gp-lea', true);
    });
    expect(assignCall()?.[2]?.body).toStrictEqual({
      poolId: 'pool-1',
      role: 'declarant',
      personId: 'gp-lea',
      confirm: true,
    });
  });
});
