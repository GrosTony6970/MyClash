import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from '@myclash/ui';

/**
 * A toast hides itself after a few seconds ("Saved" after 3 s). Its timer must end with the
 * page: one left running fired after a test had torn down its browser and failed a run whose
 * tests all passed (`window is not defined` in a settings-page test, CI on Dependabot PR #89).
 * The toasts live in `@myclash/ui`, which has no DOM to test in.
 */

let toast: ReturnType<typeof useToast>;
function Page() {
  const value = useToast();
  useEffect(() => {
    toast = value;
  });
  return null;
}

let container: HTMLDivElement;
let root: Root;

const shown = () => [...container.querySelectorAll('[role="status"]')].map((t) => t.textContent);

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <ToastProvider>
        <Page />
      </ToastProvider>,
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

// Test data, not copy: the provider shows whatever message it is given.
const SAVED = 'Saved';
const CHECK = 'Check the dates';
const COPIED = 'Copied';
const FAILED = 'Could not save';

function wait(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('a toast that hides itself', () => {
  it('leaves no timer running once the page has closed', () => {
    act(() => toast.success(SAVED));
    act(() => toast.warning(CHECK));
    expect(shown()).toEqual([`✓${SAVED}`, `⚠${CHECK}`]);
    expect(vi.getTimerCount()).toBe(2);

    act(() => root.unmount());

    expect(vi.getTimerCount()).toBe(0);
  });

  it('still hides "Saved" after three seconds, and only that toast', () => {
    act(() => toast.success(SAVED));
    act(() => toast.warning(CHECK));

    wait(2999);
    expect(shown()).toEqual([`✓${SAVED}`, `⚠${CHECK}`]);
    wait(1);
    expect(shown()).toEqual([`⚠${CHECK}`]);

    act(() => root.unmount());
  });

  it('keeps its own three seconds when another toast arrives', () => {
    act(() => toast.success(SAVED));
    wait(2000);
    act(() => toast.info(COPIED));
    wait(1000);
    expect(shown()).toEqual([`i${COPIED}`]);

    act(() => root.unmount());
  });

  it('leaves an error on screen until it is clicked', () => {
    act(() => toast.error(FAILED));
    wait(60_000);
    expect(shown()).toEqual([`!${FAILED}`]);
    expect(vi.getTimerCount()).toBe(0);

    act(() => root.unmount());
  });
});
