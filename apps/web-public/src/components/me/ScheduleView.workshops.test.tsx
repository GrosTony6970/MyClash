// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScheduleView } from './ScheduleView';
import type { PersonSchedule, ScheduleMatch } from './types';

/**
 * Marie teaches "Demo Workshop 6" from 16:00 to 18:00 and books a seat in Jean's class on
 * Sunday. Her Schedule tab listed only the seat: the class she teaches was missing, so a bout
 * at 16:30 clashed with nothing.
 */
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@myclash/next-i18n/client', () => ({
  useI18n: () => ({
    locale: 'en',
    t: (key: string, vars?: Record<string, string | number>) =>
      vars ? `${key}${JSON.stringify(vars)}` : key,
  }),
}));
vi.mock('@myclash/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  // Before the Event: nothing live, nothing scrolled to.
  useClock: () => ({ nowMs: Date.parse('2027-05-01T00:00:00Z'), simulated: false }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView = () => {};

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const bout: ScheduleMatch = {
  id: 'm-1',
  roundCode: 'LSW-P1-M01',
  status: 'scheduled',
  scheduledAt: '2027-05-22T14:30:00Z',
  durationMinutes: 10,
  fallbackEndsAt: null,
  opponentName: 'Léa',
  opponentClub: null,
  redScore: 0,
  blueScore: 0,
  outcome: null,
  isRed: true,
  sideColors: { red: 'red', blue: 'blue' },
  poolId: null,
  poolName: null,
  tournamentName: 'Longsword Open',
  tournamentId: 't-1',
  phase: 'bracket',
  phaseId: 'ph-1',
  liceName: 'Lice 1',
} as ScheduleMatch;

const schedule: PersonSchedule = {
  personId: 'p-marie',
  timezone: 'UTC',
  matches: [bout],
  refereeSlots: [],
  teaching: [
    {
      sessionId: 's-demo',
      workshopSlug: 'demo-6',
      workshopName: 'Demo Workshop 6',
      sessionStart: '2027-05-22T14:00:00Z',
      sessionEnd: '2027-05-22T16:00:00Z',
      location: 'Hall C',
      sessionCancelled: false,
    },
  ],
  workshops: [
    {
      workshopId: 's-jean',
      workshopSlug: 'jean',
      workshopName: "Jean's class",
      sessionStart: '2027-05-23T09:00:00Z',
      sessionEnd: null,
      location: null,
      status: 'confirmed',
      sessionCancelled: false,
      instructorNames: ['Jean Dupont', 'Ana Ruiz'],
    },
  ],
};

const card = (id: string) => container.querySelector(`[id="${id}"]`)!;

function draw(s: PersonSchedule = schedule) {
  act(() => root.render(<ScheduleView schedule={s} timezone="UTC" eventSlug="open-2027" />));
}

describe('the Workshops of the Schedule tab', () => {
  it('marks a session she teaches "Instructor", with its end, and opens her instructor page', () => {
    draw();
    const taught = card('ws-s-demo');
    expect(taught.textContent).toContain('Demo Workshop 6');
    expect(taught.textContent).toContain('publicApp.me.events.roleInstructor');
    expect(taught.textContent).toContain('publicApp.me.schedule.until{"time":"16:00"}');
    // Nobody named: it is her own class.
    expect(taught.textContent).not.toContain('withInstructors');
    expect(taught.querySelector('a')?.getAttribute('href')).toBe('/me/instructor');
  });

  it('marks a session she attends "Attending", and names who teaches it; no end, no "until"', () => {
    draw();
    const attended = card('ws-s-jean');
    expect(attended.textContent).toContain('publicApp.me.events.roleParticipant');
    expect(attended.textContent).toContain(
      'publicApp.me.schedule.withInstructors{"names":"Jean Dupont and Ana Ruiz"}',
    );
    expect(attended.textContent).not.toContain('publicApp.me.schedule.until');
  });

  it('flags the bout that falls in the class she teaches, on both cards', () => {
    draw();
    expect(card('ws-s-demo').textContent).toContain('publicApp.me.schedule.conflictsWith');
    expect(card('fight-m-1').textContent).toContain('publicApp.me.schedule.conflictsWith');
  });

  it('shows a session she teaches and booked once, as taught', () => {
    draw({
      ...schedule,
      workshops: [{ ...schedule.workshops![0]!, workshopId: 's-demo' }],
    });
    expect(container.querySelectorAll('[id="ws-s-demo"]')).toHaveLength(1);
    expect(card('ws-s-demo').textContent).toContain('publicApp.me.events.roleInstructor');
  });
});
