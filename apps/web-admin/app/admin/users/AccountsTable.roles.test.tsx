import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '@/i18n/I18nProvider';
import { AccountsTable } from './AccountsTable';
import type { AdminUser } from './types';

/** The Organisers tab names each club role in words (X1), as docs/HIERARCHY.md does. */
const LEA: AdminUser = {
  id: 'user-lea',
  email: 'lea@example.test',
  display_name: 'Léa',
  organizations: [
    { id: 'org-1', name: 'Lyon Escrime', slug: 'lyon', role: 'workshop_lead' },
    { id: 'org-2', name: 'Paris HEMA', slug: 'paris', role: 'read_only' },
  ],
};

let container: HTMLDivElement;
let root: Root;

async function render(locale: 'en' | 'fr') {
  await act(async () => {
    root.render(
      <I18nProvider locale={locale}>
        <AccountsTable
          tab="organizer"
          users={[LEA]}
          onToggle={() => undefined}
          onDelete={() => undefined}
        />
      </I18nProvider>,
    );
  });
}

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

describe('the Organisers tab of the accounts table', () => {
  it('names a club role in words, never its raw value', async () => {
    await render('en');
    expect(container.textContent).toContain('Lyon Escrime · Instructor');
    expect(container.textContent).toContain('Paris HEMA · Read only');
    expect(container.textContent).not.toContain('workshop_lead');
  });

  it('names it in French for a French reader', async () => {
    await render('fr');
    expect(container.textContent).toContain('Lyon Escrime · Instructeur');
    expect(container.textContent).toContain('Paris HEMA · Lecture seule');
  });
});
