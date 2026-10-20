import { act, useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { normalizeMatchFormatConfig } from '@myclash/rulesets';
import { FAILED_READ, openEventPage, type OpenedPage } from '../../archived-page.fixtures';
import {
  EFFECTIVE_RULES,
  TOURNAMENT_READS,
  TOURNAMENT_ROW,
  button,
} from '../[tournamentId]/settings/page.fixtures';
import { Step2MatchFormat } from './_wizard/Step2MatchFormat';
import { Step3Display } from './_wizard/Step3Display';
import { Step4Advanced } from './_wizard/Step4Advanced';
import NewTournamentPage from './page';

/**
 * The wizard's rules steps read the rules in force (`effectiveRules`) and hold no default of their
 * own (operator rulings 43, 46): they show the values in force, no form before the read, an error
 * and a Retry when it fails, and a Next that sends only what changed, with its step. Step 2 used
 * to write cap 5 / 180 s / soft clock 60 into every Tournament whose organiser pressed Next
 * without looking.
 */
const STEP = vi.hoisted(() => ({ n: 2 }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'org', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/org/events/ev1/tournaments/new',
  useSearchParams: () => new URLSearchParams(`id=t-1&step=${STEP.n}`),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const TOURNAMENT = '/api/v1/tournaments/t-1';
const SAVE = `PATCH ${TOURNAMENT}`;

/** Rules in force the raw row (it stores nothing) does not hold: cap 7, a +3, a win bonus of 4. */
const MARKED = {
  ...EFFECTIVE_RULES,
  matchFormat: normalizeMatchFormatConfig({ pointCap: 7 }),
  scoring: {
    ...EFFECTIVE_RULES.scoring,
    buttons: { clean: [{ label: '+3', value: 3, visible: true }], afterblow: [] },
  },
  tf: { ...EFFECTIVE_RULES.tf, winBonus: 4 },
};
const READS = { ...TOURNAMENT_READS, [TOURNAMENT]: { ...TOURNAMENT_ROW, effectiveRules: MARKED } };

let page: OpenedPage;
afterEach(() => page.unmount());

/** The body of every PATCH of the Tournament the wizard sent. */
const stepSaves = () =>
  vi
    .mocked(apiRequest)
    .mock.calls.filter(([, path, init]) => path === TOURNAMENT && init?.method === 'PATCH')
    .map(([, , init]) => init?.body);
const numbers = () =>
  [...document.body.querySelectorAll<HTMLInputElement>('input[type="number"]')].map((i) => i.value);
const buttons = () => [...document.body.querySelectorAll('button')].map((b) => b.textContent);
async function tap(label: string) {
  await act(async () => button(label).click());
  await page.settle();
}

describe("the wizard's rules steps", () => {
  it.each([
    [2, 'Next', ['7']],
    [3, 'Next', ['3']],
    [4, 'Finish', ['4']],
  ])(
    'step %i shows the rules in force, and an untouched %s sends only the step',
    async (step, label, shown) => {
      STEP.n = step;
      page = await openEventPage(<NewTournamentPage />, READS, { [SAVE]: {} });
      expect(numbers()).toEqual(expect.arrayContaining(shown));
      await tap(label);
      expect(stepSaves()).toEqual([{ wizardStep: step }]);
    },
  );

  it.each([2, 3, 4])(
    'step %i shows the error and a Retry, and no save, when the read fails',
    async (step) => {
      STEP.n = step;
      page = await openEventPage(<NewTournamentPage />, {
        ...TOURNAMENT_READS,
        [TOURNAMENT]: FAILED_READ,
      });
      const alert = document.body.querySelector('[role="alert"]')?.textContent;
      expect(alert).toContain('Could not load the rules');
      expect(alert).toContain('Retry');
      expect(buttons()).not.toContain('Next');
      expect(numbers()).toEqual([]);
      // Step 4 keeps "finish with defaults" as the way out; its own Finish is closed.
      if (step === 4) expect(button('Finish').disabled).toBe(true);
    },
  );

  it.each([2, 3, 4])('step %i shows no form before the rules are read', async (step) => {
    const noop = () => undefined;
    const steps: Record<number, ReactNode> = {
      2: <Step2MatchFormat tournamentId="t-1" onNext={noop} onBack={noop} readOnly={false} />,
      3: <Step3Display tournamentId="t-1" onNext={noop} onBack={noop} readOnly={false} />,
      4: (
        <Step4Advanced
          tournamentId="t-1"
          eventId="ev1"
          onBack={noop}
          onFinish={async () => undefined}
          readOnly={false}
        />
      ),
    };
    /** The step, mounted when the test says, so its read can be held from the start. */
    function Gate() {
      const [open, setOpen] = useState(false);
      return open ? steps[step] : <button data-gate onClick={() => setOpen(true)} />;
    }
    page = await openEventPage(<Gate />, READS);
    const served = vi.mocked(apiRequest).getMockImplementation()!;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    vi.mocked(apiRequest).mockImplementation(async (base, path, init) => {
      if (path === TOURNAMENT) await held;
      return served(base, path, init);
    });

    await act(async () => document.body.querySelector<HTMLButtonElement>('[data-gate]')!.click());
    await page.settle();
    expect(numbers().filter((v) => ['7', '3', '4'].includes(v))).toEqual([]);
    expect(buttons()).not.toContain('Next');

    release();
    await page.settle();
    expect(numbers()).toContain({ 2: '7', 3: '3', 4: '4' }[step]);
  });
});
