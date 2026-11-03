// @vitest-environment jsdom
import { Activity, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@myclash/i18n';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../i18n/I18nProvider';
import { ShareButton } from './ShareButton';

/**
 * "Copied!" reads "Share" again after two seconds, whatever React does to the button meanwhile.
 *
 * React may clean an effect up and set it up again while the button stays on the page, its
 * state kept: Strict Mode does it once as a page wakes up, and a hidden `<Activity>` does it
 * when it shows again. The browser suite tapped Share in that moment on CI
 * (`tests/a11y/share-button.spec.ts`, run 41651246858): the cleanup stopped the timer the tap
 * had just started, and "Copied!" stayed for good. Hiding and showing an `<Activity>` is that
 * cleanup and setup, on demand.
 */

const { share, copied, copyFailed } = en.publicApp.share;

let container: HTMLDivElement;
let root: Root;
let copy: ReturnType<typeof vi.fn>;

const button = () => container.querySelector<HTMLButtonElement>('[data-testid="share-button"]')!;
const said = () => container.querySelector('[data-testid="share-status"]')!.textContent;

function render(mode: 'visible' | 'hidden') {
  act(() =>
    root.render(
      <I18nProvider locale="en">
        <Activity mode={mode}>
          <ShareButton path="/e/test-event/match/bout-1" />
        </Activity>
      </I18nProvider>,
    ),
  );
}

async function tap() {
  await act(async () => {
    button().click();
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
  // A computer: no share sheet, a clipboard.
  copy = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: copy },
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  render('visible');
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('the Share button', () => {
  it('says "Copied!" for two seconds though React sets it up again meanwhile', async () => {
    await tap();
    expect(copy).toHaveBeenCalledWith(`${window.location.origin}/e/test-event/match/bout-1`);
    expect(button().textContent).toBe(copied);

    wait(500);
    render('hidden');
    render('visible');
    expect(button().textContent).toBe(copied);

    wait(2_000);
    expect(button().textContent).toBe(share);
    expect(said()).toBe('');
  });

  it('says a refused copy for six seconds, not two', async () => {
    copy.mockImplementation(() => Promise.reject(new Error('refused')));
    await tap();
    expect(button().textContent).toBe(copyFailed);

    wait(5_999);
    expect(button().textContent).toBe(copyFailed);
    wait(1);
    expect(button().textContent).toBe(share);
  });

  it('starts the two seconds again on a second tap', async () => {
    await tap();
    wait(1_500);
    await tap();
    wait(1_500);
    // Three seconds after the first tap: its own two seconds are over.
    expect(button().textContent).toBe(copied);
    wait(500);
    expect(button().textContent).toBe(share);
    expect(copy).toHaveBeenCalledTimes(2);
  });
});
