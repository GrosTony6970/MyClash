import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n/I18nProvider';
import { AvailabilityChips } from './AvailabilityChips';
import { DayAvailability } from './DayAvailability';
import type { DayTick } from './day-window';

/**
 * The roster's availability cells (ADR-019, rulings 145-147). No tick = available for
 * everything, shown "✓ All" — the board reads it the same way. A ticked day carries one
 * from–to; a date the Event no longer holds is greyed and never sent back (ruling 149).
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(node: React.ReactNode) {
  act(() => {
    root.render(<I18nProvider locale="en">{node}</I18nProvider>);
  });
}

const buttons = () => [...container.querySelectorAll('button')];
const button = (label: string) => {
  const found = buttons().find((b) => b.textContent === label);
  if (!found) throw new Error(`no button "${label}" in: ${buttons().map((b) => b.textContent)}`);
  return found;
};
const click = (el: HTMLElement) => act(() => el.click());

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  act(() => {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
}
const box = (label: string) => {
  const found = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!found) throw new Error(`no box "${label}"`);
  return found;
};

describe('AvailabilityChips', () => {
  const OPTIONS = [
    { value: 't-ls', label: 'Longsword' },
    { value: 't-sabre', label: 'Sabre' },
  ];

  it('shows no tick as "✓ All", opens every chip ticked without saving, and saves the rest', () => {
    const onChange = vi.fn();
    render(
      <AvailabilityChips
        options={OPTIONS}
        selected={[]}
        allLabel="All tournaments"
        onChange={onChange}
      />,
    );
    expect(buttons().map((b) => b.textContent)).toEqual(['✓ All tournaments']);

    click(button('✓ All tournaments'));
    expect(onChange).not.toHaveBeenCalled();
    expect(buttons().map((b) => b.className.includes('text-success'))).toEqual([true, true]);

    click(button('Sabre'));
    expect(onChange.mock.calls).toEqual([[['t-ls']]]);
  });

  it('keeps the last tick, saying why: no tick would mean everything (ruling 151)', () => {
    const onChange = vi.fn();
    render(
      <AvailabilityChips
        options={OPTIONS}
        selected={['t-ls']}
        allLabel="All"
        onChange={onChange}
      />,
    );
    const last = button('Longsword');
    click(last);
    expect(onChange).not.toHaveBeenCalled();
    expect(last.getAttribute('aria-disabled')).toBe('true');
    expect(last.title).toBe(
      'The last tick stays: no tick means available for everything. To stop this referee, take them off the roster.',
    );
    // Ticking another first still works; then either may go.
    click(button('Sabre'));
    expect(onChange.mock.calls).toEqual([[['t-ls', 't-sabre']]]);
    expect(button('Sabre').getAttribute('aria-disabled')).toBeNull();
  });

  it('ticks the rest with "all", which the API stores as no tick', () => {
    const onChange = vi.fn();
    render(
      <AvailabilityChips
        options={OPTIONS}
        selected={['t-ls']}
        allLabel="All"
        onChange={onChange}
      />,
    );
    click(button('all'));
    expect(onChange.mock.calls).toEqual([[['t-ls', 't-sabre']]]);
  });
});

describe('DayAvailability', () => {
  const DATES = ['2026-09-12', '2026-09-13'];
  const renderDays = (days: DayTick[], onSave = vi.fn()) => {
    render(<DayAvailability days={days} eventDates={DATES} disabled={false} onSave={onSave} />);
    return onSave;
  };

  it('shows a date the Event no longer holds greyed, in words, and never sends it back', () => {
    const onSave = renderDays([{ date: '2026-09-14', fromMinute: null, toMinute: null }]);
    const stale = [...container.querySelectorAll('span.line-through')];
    expect(stale.map((s) => s.textContent)).toEqual([
      "Mon 14 — Outside the Event's dates: never matches a duty",
    ]);
    // Not "✓ All": a row exists, and it matches no day of the Event.
    expect(buttons().map((b) => b.textContent)).toEqual(['Sat 12', 'Sun 13']);

    click(button('Sat 12'));
    expect(onSave.mock.calls).toEqual([
      [[{ date: '2026-09-12', fromMinute: null, toMinute: null }]],
    ]);
  });

  it("saves a day's window with every other ticked day as it stands", () => {
    const onSave = renderDays([
      { date: '2026-09-12', fromMinute: null, toMinute: null },
      { date: '2026-09-13', fromMinute: 540, toMinute: 1440 },
    ]);
    expect(box('Sun 13 — From').value).toBe('09:00');
    expect(box('Sun 13 — Until').value).toBe('');

    type(box('Sat 12 — Until'), '16:00');
    expect(onSave.mock.calls).toEqual([
      [
        [
          { date: '2026-09-12', fromMinute: 0, toMinute: 960 },
          { date: '2026-09-13', fromMinute: 540, toMinute: 1440 },
        ],
      ],
    ]);
  });

  it("keeps an untick's other windows, and refuses a window that runs backwards in words", () => {
    const onSave = renderDays([
      { date: '2026-09-12', fromMinute: 540, toMinute: 960 },
      { date: '2026-09-13', fromMinute: null, toMinute: null },
    ]);
    type(box('Sat 12 — From'), '17:00');
    expect(onSave).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'The start must be before the end.',
    );

    click(button('Sun 13'));
    expect(onSave.mock.calls).toEqual([[[{ date: '2026-09-12', fromMinute: 540, toMinute: 960 }]]]);
  });

  it('opens "✓ All days" to every day, where a window saves the whole list', () => {
    const onSave = renderDays([]);
    click(button('✓ All days'));
    type(box('Sun 13 — Until'), '12:00');
    expect(onSave.mock.calls).toEqual([
      [
        [
          { date: '2026-09-12', fromMinute: null, toMinute: null },
          { date: '2026-09-13', fromMinute: 0, toMinute: 720 },
        ],
      ],
    ]);
  });
});
