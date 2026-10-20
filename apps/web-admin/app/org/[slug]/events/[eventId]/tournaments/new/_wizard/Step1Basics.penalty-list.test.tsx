import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@myclash/ui';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { I18nProvider } from '@/i18n/I18nProvider';
import type * as SelectableRulesets from '@/lib/selectable-rulesets';
import { FORFEIT_RULES_READ } from '../../[tournamentId]/settings/page.fixtures';
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

const context = vi.hoisted(() => ({
  orgId: null as string | null,
  catalog: [{ code: 'TF_v1', version: '1', label: 'TF v1' }],
}));
vi.mock('@/components/organizer-event-context', () => ({
  useOrganizerSelectedEvent: () => ({ orgId: context.orgId }),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@/hooks/useWeaponOptions', () => ({ useWeaponOptions: () => [] }));
vi.mock('@/lib/selectable-rulesets', async (importOriginal) => ({
  ...(await importOriginal<typeof SelectableRulesets>()),
  fetchSelectableRulesets: async () => context.catalog,
}));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const ORG_LIST = '/api/v1/organizations/org-a/penalty-rulesets';
const CREATE = '/api/v1/events/ev1/tournaments';
const FORFEIT_READ = '/api/v1/events/ev1/forfeit-rules';

/** Answers the step's reads. A request nobody expected throws. */
function serve() {
  vi.mocked(apiRequest).mockImplementation(async (_base: string, path: string) => {
    if (path === CREATE) return { ok: true, data: { id: 't1' } };
    // The forfeit block's read of the pick on screen (ruling 70).
    if (path.startsWith(FORFEIT_READ)) return { ok: true, data: FORFEIT_RULES_READ };
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

const allRequested = () => vi.mocked(apiRequest).mock.calls.map(([, path]) => path);
/** The requests but the forfeit block's, which follows the pick. */
const requested = () => allRequested().filter((path) => !path.startsWith(FORFEIT_READ));

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
  context.catalog = [{ code: 'TF_v1', version: '1', label: 'TF v1' }];
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
          <Step1Basics
            eventId="ev1"
            initialTournamentId={null}
            onCreated={() => {}}
            readOnly={false}
          />
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
    // The forfeit block shows the rules of the pick it pre-selected.
    expect(allRequested()).toContain(`${FORFEIT_READ}?penaltyRulesetId=p-builtin`);
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

/**
 * The version a new Tournament is created with comes from the picker's list,
 * which offers the latest of each built-in. With no list, none is sent and the
 * server gives the latest: never an older engine by default.
 */
describe('new-tournament wizard ruleset version', () => {
  async function createNamed() {
    const input = container.querySelector<HTMLInputElement>('[data-testid="tournament-name"]')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(input, 'Longsword');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="tournament-create"]')!.click();
    });
    await settle();
    const call = vi.mocked(apiRequest).mock.calls.find(([, path]) => path === CREATE);
    return (call?.[2] as { body: Record<string, unknown> }).body;
  }

  it('sends the version of the list it fetched', async () => {
    context.orgId = 'org-a';
    context.catalog = [{ code: 'TF_v1', version: '1.1.0', label: 'TF v1' }];
    await openStep();
    expect(await createNamed()).toMatchObject({ rulesetCode: 'TF_v1', rulesetVersion: '1.1.0' });
  });

  it('sends no version when the list did not load', async () => {
    context.orgId = 'org-a';
    context.catalog = [];
    await openStep();
    const body = await createNamed();
    expect(body['rulesetCode']).toBe('TF_v1');
    expect(body['rulesetVersion']).toBeUndefined();
  });
});
