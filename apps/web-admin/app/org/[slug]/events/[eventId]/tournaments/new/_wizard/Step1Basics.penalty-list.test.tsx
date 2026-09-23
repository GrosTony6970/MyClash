import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@myclash/ui';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import { Step1Basics } from './Step1Basics';

/**
 * Which penalty rulesets the new-tournament wizard offers.
 *
 * It used to load the platform-wide list, which held every organisation's
 * private rulesets. That list is for platform staff now (operator ruling 62),
 * so the wizard asks for its own organisation's list, as the Tournament settings
 * tab does, and waits until the layout knows which organisation that is.
 *
 * The step is MOUNTED, not rendered to markup: the reads start in an effect.
 */

const context = vi.hoisted(() => ({ orgId: null as string | null }));
vi.mock('@/components/organizer-event-context', () => ({
  useOrganizerSelectedEvent: () => ({ orgId: context.orgId }),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@/hooks/useWeaponOptions', () => ({ useWeaponOptions: () => [] }));
vi.mock('@/lib/selectable-rulesets', () => ({
  fetchSelectableRulesets: async () => [{ code: 'TF_v1', version: '1', label: 'TF v1' }],
}));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const ORG_LIST = '/api/v1/organizations/org-a/penalty-rulesets';

/** Answers the step's reads. A request nobody expected throws. */
function serve() {
  vi.mocked(apiRequest).mockImplementation(async (_base: string, path: string) => {
    if (path === ORG_LIST) {
      return {
        ok: true,
        data: [
          { id: 'p-own', name: 'Club A house rules', built_in: false },
          { id: 'p-builtin', name: 'FFAMHE penalties', built_in: true },
        ],
      };
    }
    throw new Error(`unexpected request ${path}`);
  });
}

const requested = () => vi.mocked(apiRequest).mock.calls.map(([, path]) => path);

/** Lets every pending fetch and state update land. */
async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(apiRequest).mockReset();
  serve();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function openStep() {
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <ToastProvider>
          <Step1Basics eventId="ev1" initialTournamentId={null} onCreated={() => {}} />
        </ToastProvider>
      </I18nProvider>,
    );
  });
  await settle();
}

describe('new-tournament wizard penalty rulesets', () => {
  it("offers the organisation's own list and pre-selects the built-in", async () => {
    context.orgId = 'org-a';
    await openStep();

    expect(requested()).toEqual([ORG_LIST]);
    const penaltySelect = [...container.querySelectorAll('select')].find((select) =>
      select.querySelector('option[value="p-builtin"]'),
    );
    expect(penaltySelect?.value).toBe('p-builtin');
    expect(penaltySelect?.textContent).toContain('Club A house rules');
  });

  it('asks for no penalty list until the organisation is known, then asks once', async () => {
    context.orgId = null;
    await openStep();
    expect(requested()).toEqual([]);

    // The layout resolves the organisation after the step has mounted.
    context.orgId = 'org-a';
    await openStep();
    expect(requested()).toEqual([ORG_LIST]);
  });
});
