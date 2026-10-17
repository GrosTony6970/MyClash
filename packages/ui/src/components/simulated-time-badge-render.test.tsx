import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { SimulatedTimeBadge } from './SimulatedTimeBadge';

/**
 * The badge the public app, the organiser live board and the display wall show
 * while a super-admin simulates the clock. It says when the clock is paused, and
 * stays hidden for a flag that is on but moves no clock.
 */
const clock = vi.hoisted(() => ({ nowMs: 0, simulated: false, frozen: false }));
vi.mock('../hooks/useNow', () => ({ useClock: () => clock }));

const NOW_MS = Date.parse('2027-05-22T08:15:30.000Z');
const t = (key: string, values?: Record<string, unknown>) => `${key}|${String(values?.['time'])}`;

function render(): string {
  return renderToStaticMarkup(
    <SimulatedTimeBadge apiUrl="http://api.test" t={t} bcp47Locale="en-GB" />,
  );
}

describe('SimulatedTimeBadge', () => {
  it('shows nothing while no simulation drives the clock', () => {
    Object.assign(clock, { nowMs: NOW_MS, simulated: false, frozen: false });
    expect(render()).toBe('');
  });

  it('shows the running simulated time', () => {
    Object.assign(clock, { nowMs: NOW_MS, simulated: true, frozen: false });
    const html = render();
    expect(html).toContain(
      `common.simulatedTime.running|${new Date(NOW_MS).toLocaleString('en-GB')}`,
    );
    expect(html).toContain('animate-pulse');
  });

  it('says the clock is paused, and stops its pulse', () => {
    Object.assign(clock, { nowMs: NOW_MS, simulated: true, frozen: true });
    const html = render();
    expect(html).toContain('common.simulatedTime.paused|');
    expect(html).not.toContain('animate-pulse');
  });
});
