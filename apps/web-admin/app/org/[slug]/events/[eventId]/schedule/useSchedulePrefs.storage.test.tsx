import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useSchedulePrefs, type SchedulePrefs } from './useSchedulePrefs';

/**
 * The board's kept settings read and wrote the browser's storage with no guard. A browser with
 * site data blocked throws as soon as a page names `localStorage`, and a full one refuses the
 * write: the board then failed to open, or a toggle did nothing, in silence. The choice now
 * holds for the tab either way.
 */
let prefs: SchedulePrefs;
let root: Root;
let container: HTMLDivElement;
const real = Object.getOwnPropertyDescriptor(window, 'localStorage')!;

function Harness() {
  const latest = useSchedulePrefs();
  useEffect(() => {
    prefs = latest;
  });
  return null;
}

async function open() {
  container = document.createElement('div');
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  act(() => root.unmount());
  Object.defineProperty(window, 'localStorage', real);
});

describe('the kept settings of the board when storage refuses', () => {
  it('open on their defaults and keep a choice for the tab when storage is blocked', async () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
    await open();
    expect(prefs.viewMode).toBe('blocks');
    await act(async () => prefs.setViewMode('grid'));
    expect(prefs.viewMode).toBe('grid');
  });

  it('keep a choice for the tab when storage is full', async () => {
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
      removeItem: () => undefined,
    };
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => full });
    await open();
    await act(async () => prefs.setPanelCollapsed(true));
    expect(prefs.panelCollapsed).toBe(true);
  });
});
