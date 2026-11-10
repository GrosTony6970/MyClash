// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../../../src/i18n/I18nProvider';
import { UnknownCallerNotice } from './WorkshopPageParts';

/**
 * What a caller the booking door did not know reads, with and without the Event's join switch
 * (rulings 516, 568). Off: today's notices. On: an account joins from here, and a visitor is
 * offered an account besides the list and the sign-in.
 */
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

const JOIN = { apiUrl: 'http://api.test', eventId: 'ev-1' };

function show(who: 'account' | 'visitor', join: typeof JOIN | null) {
  act(() => {
    root.render(
      <I18nProvider locale="en">
        <UnknownCallerNotice
          who={who}
          eventSlug="open-2027"
          join={join}
          onJoined={async () => undefined}
        />
      </I18nProvider>,
    );
  });
}
const hrefs = () => [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));

describe('the notice under the sessions, by the join switch', () => {
  it('offers an account the join when the Event allows it', () => {
    show('account', JOIN);
    expect(container.textContent).toContain('Join and book');
    expect(container.textContent).not.toContain('Ask the organiser to add you');
  });

  it('tells an account to ask the organiser when the Event does not', () => {
    show('account', null);
    expect(container.textContent).toContain('Ask the organiser to add you');
    expect(container.querySelector('form')).toBeNull();
  });

  it('offers a visitor "Create an account", back to this Workshop, when the Event allows it', () => {
    show('visitor', JOIN);
    expect(hrefs()).toContain(
      `/login?tab=signup&next=${encodeURIComponent('/e/open-2027/w/longsword')}`,
    );
  });

  it('offers a visitor no account when the Event does not', () => {
    show('visitor', null);
    expect(hrefs().some((href) => href?.includes('tab=signup'))).toBe(false);
  });
});
