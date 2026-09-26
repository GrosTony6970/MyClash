import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '@/i18n/I18nProvider';
import { RefereeConflictBanner } from './RefereeConflictBanner';

/**
 * A clean server re-read is only an all-clear when every amber rule was checked. Rest
 * (ADR-019) is on by default, so 0 slots is a rule switched off and the banner says so; a
 * cap of 0 is no limit set, and a board with no cap can still be clean.
 */

const RULES = {
  ownPool: true,
  ownPoolSpan: true,
  twoRoles: true,
  attendWorkshop: true,
  restSlots: 1,
  maxBoutsPerDay: 0,
};

let container: HTMLDivElement;
let root: Root;

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

function renderWith(rules: typeof RULES) {
  act(() => {
    root.render(
      <I18nProvider locale="en">
        <RefereeConflictBanner
          live={[]}
          crew={{ ok: true, conflicts: [], rules, asOf: '2026-06-13T09:30:00.000Z' }}
          eventTz="UTC"
        />
      </I18nProvider>,
    );
  });
}

describe('RefereeConflictBanner — rules off', () => {
  it('stays hidden on a clean re-read with rest on and no cap set', () => {
    renderWith(RULES);
    expect(container.textContent).toBe('');
  });

  it('names rest when it is switched off, rather than calling the board clean', () => {
    renderWith({ ...RULES, restSlots: 0 });
    expect(container.textContent).toContain('Rest between duties');
  });
});
