// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../../../src/i18n/I18nProvider';
import { SessionWhen } from './WorkshopPageParts';

/** What a visitor reads of a session's seats on the workshop page: the count, and the seats left. */
vi.mock('next/navigation', () => ({ usePathname: () => '/e/open-2027/w/longsword' }));
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
});

const SESSION = { startsAt: null, endsAt: null, locationLabel: 'Area 1' };

function render(seats: { confirmed: number; capacity: number } | null, locale: 'en' | 'fr' = 'en') {
  act(() =>
    root.render(
      <I18nProvider locale={locale}>
        <SessionWhen session={SESSION} timezone="Europe/Paris" bcp47={locale} seats={seats} />
      </I18nProvider>,
    ),
  );
  return container.textContent ?? '';
}

describe('SessionWhen seats', () => {
  it('shows the seats left of an almost-full session', () => {
    expect(render({ confirmed: 8, capacity: 10 })).toContain('8/10 enrolled');
    expect(render({ confirmed: 8, capacity: 10 })).toContain('Almost full · 2 spots');
    expect(render({ confirmed: 8, capacity: 10 }, 'fr')).toContain('Presque complet · 2 places');
  });

  it('shows the seats left of a session with room', () => {
    expect(render({ confirmed: 2, capacity: 10 }, 'fr')).toContain('8 places restantes');
  });

  it('shows a full session as full', () => {
    expect(render({ confirmed: 10, capacity: 10 }, 'fr')).toContain('Complet');
  });

  it('shows no count and no badge when the Workshop has no limit', () => {
    const text = render(null);
    expect(text).toContain('Area 1');
    expect(text).not.toMatch(/enrolled|spot|full/i);
  });
});
