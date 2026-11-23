// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../src/i18n/I18nProvider';
import {
  WorkshopRegisterControls,
  registerLabels,
} from '../../../src/components/me/WorkshopRegisterControls';
import { InstructorDashboard } from './InstructorDashboard';

/**
 * Anthony teaches "Demo Workshop 3". On the event's Workshops page its card said "You teach this
 * workshop" on a dead button. Now the button is a link to his own page, which opens that
 * Workshop's Edit panel (operator, 2026-11-23).
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../../../src/hooks/useWeaponOptions', () => ({ useWeaponOptions: () => [] }));
vi.mock('../../../src/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  vi.unstubAllGlobals();
  window.location.hash = '';
});

const workshop = (id: string, title: string) => ({
  id,
  slug: id,
  title,
  shortDescription: null,
  prerequisites: null,
  descriptionMd: null,
  category: null,
  weapon: null,
  level: null,
  language: null,
  color: null,
  coverImageUrl: null,
  capacity: 10,
  durationMinutes: null,
  sessions: [],
  instructors: [],
});

describe("the instructor's own Workshop", () => {
  it('links to its card on the instructor page instead of a dead button', () => {
    const t = (key: string) => key;
    act(() =>
      root.render(
        <WorkshopRegisterControls
          workshopId="w-3"
          booking="none"
          full={false}
          isInstructor
          labels={registerLabels(t)}
        />,
      ),
    );

    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/me/instructor#edit-w-3');
    expect(link?.textContent).toBe('publicApp.me.workshops.instructorEdit');
    expect(container.querySelector('button')).toBeNull();
  });

  it('opens on the Edit panel of the Workshop the link names, and only that one', async () => {
    window.location.hash = '#edit-w-3';
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              events: [
                {
                  event: { id: 'e', slug: 'e', name: 'Event', timezone: null, startDate: null },
                  workshops: [workshop('w-1', 'Dagger intro'), workshop('w-3', 'Demo Workshop 3')],
                  myGlobalPersonId: 'gp-1',
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );

    await act(async () =>
      root.render(
        <I18nProvider locale="en">
          <InstructorDashboard />
        </I18nProvider>,
      ),
    );

    const cardOf = (id: string) => container.querySelector(`#edit-${id}`)!;
    const saveIn = (id: string) =>
      [...cardOf(id).querySelectorAll('button')].filter((b) => b.textContent === 'Save');
    expect(saveIn('w-3')).toHaveLength(1);
    expect(saveIn('w-1')).toHaveLength(0);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });
});
