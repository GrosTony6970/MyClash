import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Ui from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { localeToBcp47 } from '@myclash/time';
import { I18nProvider } from '@/i18n/I18nProvider';
import { TimeSimulationControls } from './TimeSimulationControls';

/**
 * The time-simulation panel shows the clock visitors run — the shared seconds
 * clock over the public snapshot — so the super-admin sees what they see.
 */
const clock = vi.hoisted(() => ({ nowMs: 0, simulated: false }));

vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@myclash/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof Ui>()),
  useSecondsClock: () => clock,
}));

let container: HTMLDivElement;
let root: Root;

function Panel() {
  const { t, locale } = useI18n();
  return (
    <TimeSimulationControls
      busy={false}
      simLocal=""
      onSimLocalChange={() => undefined}
      onSave={() => undefined}
      t={t}
      locale={locale}
    />
  );
}

async function render(locale: 'en' | 'fr') {
  await act(async () => {
    root.render(
      <I18nProvider locale={locale}>
        <Panel />
      </I18nProvider>,
    );
  });
}

function readout(): string {
  return container.querySelector('[role="status"]')?.textContent ?? '';
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the time-simulation readout', () => {
  it('shows the simulated clock visitors run', async () => {
    const nowMs = Date.parse('2027-05-22T08:15:30.000Z');
    Object.assign(clock, { nowMs, simulated: true });
    await render('en');
    expect(readout()).toBe(`Visitors see ${new Date(nowMs).toLocaleString(localeToBcp47('en'))}`);
  });

  it('says visitors see real time when nothing is simulated', async () => {
    Object.assign(clock, { nowMs: Date.now(), simulated: false });
    await render('en');
    expect(readout()).toBe('Not simulating: visitors see real time');
  });

  it('speaks French to a French reader', async () => {
    Object.assign(clock, { nowMs: Date.now(), simulated: false });
    await render('fr');
    expect(readout()).toBe("Pas de simulation : les visiteurs voient l'heure réelle");
  });
});
