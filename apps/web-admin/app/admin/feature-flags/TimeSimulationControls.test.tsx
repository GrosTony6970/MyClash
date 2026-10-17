import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Ui from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { localeToBcp47 } from '@myclash/time';
import { I18nProvider } from '@/i18n/I18nProvider';
import { TimeSimulationControls } from './TimeSimulationControls';
import type { TimeSimInput } from './time-sim-controls';

/**
 * The time-simulation panel shows the clock visitors run — the shared seconds
 * clock over the public snapshot — so the super-admin sees what they see, and
 * Pause / Resume act on that same instant.
 */
const clock = vi.hoisted(() => ({ nowMs: 0, simulated: false, frozen: false }));

vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@myclash/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof Ui>()),
  useSecondsClock: () => clock,
}));

const NOW_MS = Date.parse('2027-05-22T08:15:30.000Z');

let container: HTMLDivElement;
let root: Root;
let onSave: ReturnType<typeof vi.fn<(payloadJson: TimeSimInput) => void>>;

function Panel() {
  const { t, locale } = useI18n();
  return (
    <TimeSimulationControls
      busy={false}
      simLocal=""
      onSimLocalChange={() => undefined}
      storedMode="running"
      onSave={onSave}
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

function button(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((b) => b.textContent === label);
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  onSave = vi.fn<(payloadJson: TimeSimInput) => void>();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the time-simulation readout', () => {
  it('shows the running clock visitors see', async () => {
    Object.assign(clock, { nowMs: NOW_MS, simulated: true, frozen: false });
    await render('en');
    const time = new Date(NOW_MS).toLocaleString(localeToBcp47('en'));
    expect(readout()).toBe(`Visitors see ${time}, running`);
  });

  it('says the clock is paused when it is frozen', async () => {
    Object.assign(clock, { nowMs: NOW_MS, simulated: true, frozen: true });
    await render('fr');
    const time = new Date(NOW_MS).toLocaleString(localeToBcp47('fr'));
    expect(readout()).toBe(`Les visiteurs voient ${time}, en pause`);
  });

  it('says visitors see real time when nothing is simulated, and offers no pause', async () => {
    Object.assign(clock, { nowMs: Date.now(), simulated: false, frozen: false });
    await render('en');
    expect(readout()).toBe('Not simulating: visitors see real time');
    expect(button('Pause')).toBeUndefined();
    expect(button('Resume')).toBeUndefined();
  });
});

describe('Pause and Resume', () => {
  it('Pause freezes the clock on the instant visitors see', async () => {
    Object.assign(clock, { nowMs: NOW_MS, simulated: true, frozen: false });
    await render('en');
    await act(async () => button('Pause')!.click());
    expect(onSave).toHaveBeenCalledWith({
      simulatedNowIso: '2027-05-22T08:15:30.000Z',
      mode: 'frozen',
    });
  });

  it('Resume runs the clock on from the frozen instant', async () => {
    Object.assign(clock, { nowMs: NOW_MS, simulated: true, frozen: true });
    await render('en');
    await act(async () => button('Resume')!.click());
    expect(onSave).toHaveBeenCalledWith({
      simulatedNowIso: '2027-05-22T08:15:30.000Z',
      mode: 'running',
    });
  });
});
