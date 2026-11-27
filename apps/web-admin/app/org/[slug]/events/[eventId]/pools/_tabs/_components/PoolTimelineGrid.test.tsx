import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n/I18nProvider';
import { PoolTimelineGrid, type TimelineBreak, type TimelinePool } from './PoolTimelineGrid';

/**
 * The Event timeline reads days and times on the Event's clock, puts one heading on
 * each day, and folds — the fold remembered per Event in this browser.
 *
 * The Event is in New York on purpose: neither a Paris laptop nor a UTC CI runner
 * shares its clock, so a formatter that slips back to the browser's zone goes red
 * on both.
 */

const KEY = 'myclash.eventTimeline.collapsed.event-1';
const TITLE = 'Event timeline';
const EMPTY = 'Nothing';
const NEW_YORK = 'America/New_York';

const pool = (id: string, scheduledStart: string): TimelinePool => ({
  id,
  name: id,
  tournamentId: 't-1',
  tournamentName: 'Longsword Open',
  scheduledStart,
  scheduledEnd: null,
  liceName: 'Lice 1',
  filledSlotCount: 3,
  totalSlotCount: 3,
});

// New York is UTC-4 in May.
const POOLS = [
  pool('Pool 1', '2026-05-22T13:00:00.000Z'), // Fri 09:00 New York
  pool('R16-M1', '2026-05-23T13:00:00.000Z'), // Sat 09:00 New York
  pool('Late bout', '2026-05-23T02:30:00.000Z'), // Fri 22:30 New York, Sat in UTC and Paris
];
const BREAKS: TimelineBreak[] = [
  { startIso: '2026-05-22T12:00:00.000Z', label: 'Registration', kind: 'admin' }, // Fri 08:00
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function render() {
  act(() => {
    root.render(
      <I18nProvider locale="en">
        <PoolTimelineGrid
          pools={POOLS}
          breaks={BREAKS}
          title={TITLE}
          emptyLabel={EMPTY}
          timeZone={NEW_YORK}
          eventId="event-1"
        />
      </I18nProvider>,
    );
  });
}

const foldButton = () => container.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
const days = () => [...container.querySelectorAll('h4')];

describe('PoolTimelineGrid', () => {
  it("heads each Event day once, on the Event's clock", () => {
    render();
    expect(days().map((h) => h.textContent)).toEqual(['Friday 22/05', 'Saturday 23/05']);
    const friday = container.querySelector('ol')!.textContent!;
    // 08:00 bar before the 09:00 Pool, and the 22:30 bout stays on Friday.
    expect(friday.indexOf('08:00')).toBeLessThan(friday.indexOf('Registration'));
    expect(friday.indexOf('Registration')).toBeLessThan(friday.indexOf('09:00'));
    expect(friday.indexOf('09:00')).toBeLessThan(friday.indexOf('Pool 1'));
    expect(friday).toContain('22:30');
    expect(friday).toContain('Late bout');
  });

  it('is named by its title, folds and unfolds, and remembers the fold', () => {
    render();
    expect(foldButton().textContent).toContain(TITLE);
    expect(foldButton().getAttribute('aria-expanded')).toBe('true');

    act(() => foldButton().click());
    expect(foldButton().getAttribute('aria-expanded')).toBe('false');
    expect(days()).toHaveLength(0);
    expect(window.localStorage.getItem(KEY)).toBe('1');

    act(() => foldButton().click());
    expect(days()).toHaveLength(2);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('opens folded when the fold was remembered', () => {
    window.localStorage.setItem(KEY, '1');
    render();
    expect(foldButton().getAttribute('aria-expanded')).toBe('false');
    expect(days()).toHaveLength(0);
  });

  it('still renders, open, when the browser keeps no site data', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render();
    expect(foldButton().getAttribute('aria-expanded')).toBe('true');
    expect(days()).toHaveLength(2);
  });
});
