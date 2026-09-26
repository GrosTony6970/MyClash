import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@myclash/ui';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import { StaffingTab } from './StaffingTab';

/**
 * A Staffing save that would delete referee assignments on a locked board (ADR-019) is
 * refused 409 `referee_board_locked`. The tab read every 409 as "confirm the deletions":
 * it opened the confirm dialog with nobody listed, and confirming met the same 409.
 */

vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const SLOT = { index: 1, displayName: null, allowedSkillIds: ['arbitre_declarant'] };
const CONFIG = {
  pool: [SLOT],
  bracket: [SLOT],
  finals: [SLOT],
  swiss: [SLOT],
  inheritsEventDefault: false,
  isHardCodedFloor: false,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(apiRequest).mockReset();
  vi.mocked(apiRequest).mockImplementation(async (_base: string, path: string, init) => {
    if (init?.method === 'PUT') {
      return {
        ok: false,
        kind: 'http',
        status: 409,
        code: 'referee_board_locked',
        detail: 'Referee assignments are locked. Unlock them before changing a referee.',
        details: null,
        validationErrors: null,
      } as never;
    }
    return { ok: true, data: path.endsWith('/slot-config') ? CONFIG : [] } as never;
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <ToastProvider>
          <StaffingTab eventId="ev1" apiUrl="http://api.test" skills={[]} isReadOnly={false} />
        </ToastProvider>
      </I18nProvider>,
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('StaffingTab on a locked referee board', () => {
  it('says the board is locked, in the organiser’s language, and opens no confirm dialog', async () => {
    const save = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Save changes',
    );
    await act(async () => save?.click());

    expect(vi.mocked(apiRequest).mock.calls.some(([, , init]) => init?.method === 'PUT')).toBe(
      true,
    );
    expect(document.body.textContent).toContain(
      'Referee assignments are locked. Unlock them on the Referees page first.',
    );
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });
});
