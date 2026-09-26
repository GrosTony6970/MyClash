import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n/I18nProvider';
import { AssignmentDiagnosticsPanel } from './AssignmentDiagnosticsPanel';
import type { RuleSettings } from './RefereeRulesFooter';

/**
 * The rules footer (ADR-019): rest has its switch and its number of slots, the daily bout
 * cap its number, and the three Impossible rules no box at all (hard rule 8). A number is
 * sent once, when the field is left or Enter is pressed — never per keystroke.
 */

const SETTINGS: RuleSettings = {
  enableOwnPoolRule: true,
  enableOwnPoolSpanRule: true,
  enableTwoRolesRule: true,
  workshopConflictWarning: true,
  enforceRefereeNoBackToBack: true,
  enableCapacityRule: true,
  refereeRestMinSlots: 1,
  maxBoutsPerDay: 0,
};

const BOARD = {
  pools: [{ roleSlots: [{ role: 'decl', assignment: null, missingReasons: [] }] }],
  candidates: [],
};

let container: HTMLDivElement;
let root: Root;
const onChangeRule = vi.fn();

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  onChangeRule.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(settings: RuleSettings = SETTINGS) {
  act(() => {
    root.render(
      <I18nProvider locale="en">
        <AssignmentDiagnosticsPanel
          board={BOARD}
          skillNameById={new Map()}
          ruleSettings={settings}
          onChangeRule={onChangeRule}
        />
      </I18nProvider>,
    );
  });
}

const field = (label: string) => {
  const holder = [...container.querySelectorAll('label')].find((l) =>
    l.textContent?.startsWith(label),
  );
  return holder!.querySelector('input')!;
};

/** Type into a number field the way React sees it, then leave it or press a key. */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('the referee rules footer', () => {
  it('has no box for a rule that has no switch', () => {
    render();
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/Officiate vs fight|Double-booked|Availability/);
    expect(text).toContain('Rest between duties');
    // Own Pool, Pool running, two roles, attending, rest, capacity: nothing else has a box.
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(6);
  });

  it('sends the cap once, when the field is left', () => {
    render();
    const cap = field('Daily bout cap');
    type(cap, '1');
    type(cap, '12');
    expect(onChangeRule).not.toHaveBeenCalled();
    act(() => {
      cap.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(onChangeRule.mock.calls).toEqual([['maxBoutsPerDay', 12]]);
  });

  it('sends the rest slots on Enter, and nothing out of range', () => {
    render();
    const slots = field('Slots of rest');
    type(slots, '9');
    act(() => {
      slots.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onChangeRule).not.toHaveBeenCalled();
    type(slots, '2');
    act(() => {
      slots.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onChangeRule.mock.calls).toEqual([['refereeRestMinSlots', 2]]);
  });

  it('switches rest off with its box, and hides the slots with it', () => {
    render();
    const box = field('Rest between duties');
    act(() => box.click());
    expect(onChangeRule.mock.calls).toEqual([['enforceRefereeNoBackToBack', false]]);
    render({ ...SETTINGS, enforceRefereeNoBackToBack: false });
    expect(container.textContent).not.toContain('Slots of rest');
  });
});
