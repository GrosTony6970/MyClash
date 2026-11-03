// @vitest-environment jsdom
import { Activity, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../../../../src/i18n/I18nProvider';
import { DisplayControls } from './DisplayControls';

/**
 * A touch shows a display's control bar, and the bar fades out four seconds later, whatever
 * React does to it meanwhile. React may clean an effect up and set it up again while the bar
 * stays (Strict Mode as the page wakes up, a hidden `<Activity>` shown again): the timer the
 * touch started was lost, and the bar stayed on the projection until the next touch. Hiding
 * and showing an `<Activity>` is that cleanup and setup, on demand.
 */

let container: HTMLDivElement;
let root: Root;

const shows = () =>
  container.querySelector('[data-testid="display-controls"]')!.getAttribute('aria-hidden') ===
  'false';

function render(mode: 'visible' | 'hidden') {
  act(() =>
    root.render(
      <I18nProvider locale="en">
        <Activity mode={mode}>
          <DisplayControls eventSlug="test-event" currentLiceName="Lice 1" settings={null} />
        </Activity>
      </I18nProvider>,
    ),
  );
}

function touch() {
  act(() => {
    window.dispatchEvent(new Event('pointermove'));
  });
}

function wait(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  // The first touch asks for the Event's pistes; the bar works without them.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: false })),
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  render('visible');
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("a display's control bar", () => {
  it('fades out four seconds after a touch though React sets it up again meanwhile', () => {
    expect(shows()).toBe(false);
    touch();
    expect(shows()).toBe(true);

    wait(1_000);
    render('hidden');
    render('visible');
    expect(shows()).toBe(true);

    wait(4_000);
    expect(shows()).toBe(false);
  });

  it('stays four more seconds after each touch', () => {
    touch();
    wait(3_000);
    touch();
    wait(3_000);
    expect(shows()).toBe(true);
    wait(1_000);
    expect(shows()).toBe(false);
  });

  // A timer left running after its page fails a later test (`window is not defined`).
  // The mounted page holds a timer of its own, so the count alone cannot say whose ended.
  it('stops its timer when the page goes', () => {
    const started = vi.spyOn(window, 'setTimeout');
    const stopped = vi.spyOn(window, 'clearTimeout');
    touch();
    const last = started.mock.calls.findLastIndex(([, ms]) => ms === 4_000);
    expect(last).toBeGreaterThanOrEqual(0);
    const hide = started.mock.results[last]?.value as number;
    expect(stopped).not.toHaveBeenCalledWith(hide);

    act(() => root.unmount());
    expect(stopped).toHaveBeenCalledWith(hide);
    started.mockRestore();
    stopped.mockRestore();
    // afterEach unmounts again: a fresh root keeps that a no-op.
    root = createRoot(container);
  });
});
