// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../src/i18n/I18nProvider';
import { MyDetailsPanel } from './MyDetailsPanel';

/**
 * Slice 2.6b (rulings 558, 563): Paul writes what "Dagger intro" shows about him, from his own
 * page. His profile bio is private; it is his, so it is his hint. The organiser wrote the club
 * line for this Workshop before him.
 */
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DETAILS = '/api/v1/workshops/w-1/instructors/gp-paul/details';
const VIEW = {
  override: { bio: null, club: 'Salle Lyon, Thursday group', photoUrl: null },
  profile: { bio: 'Fiore since 2010', club: 'Salle Lyon', photoUrl: null },
};

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
  vi.mocked(apiRequest).mockReset();
});

function serve(read: unknown) {
  vi.mocked(apiRequest).mockImplementation(async (_base, path, init) => {
    if (path !== DETAILS) throw new Error(`unexpected request ${path}`);
    if (init?.method === 'PATCH')
      return { ok: true, data: { ...VIEW.override, ...(init.body as object) } };
    return read as never;
  });
}

async function open() {
  await act(async () =>
    root.render(
      <I18nProvider locale="en">
        <MyDetailsPanel workshopId="w-1" globalPersonId="gp-paul" apiUrl="http://api.test" />
      </I18nProvider>,
    ),
  );
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

/** Types into a React-controlled field the way a browser does. */
function type(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = Object.getPrototypeOf(field) as object;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
}
const save = async () => {
  const button = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Save')!;
  await act(async () => button.click());
};
const patches = () =>
  vi.mocked(apiRequest).mock.calls.filter(([, , init]) => init?.method === 'PATCH');

describe("the instructor's own details for a Workshop", () => {
  it('shows his profile, private bio included, in grey in the empty boxes (563)', async () => {
    serve({ ok: true, data: VIEW });
    await open();

    const bio = container.querySelector('textarea')!;
    expect(bio.value).toBe('');
    expect(bio.placeholder).toBe('Fiore since 2010');
    expect(container.querySelector<HTMLInputElement>('input:not([type="file"])')!.value).toBe(
      'Salle Lyon, Thursday group',
    );
  });

  it("sends only the box he changed, so the organiser's club line is kept (558)", async () => {
    serve({ ok: true, data: VIEW });
    await open();

    act(() => type(container.querySelector('textarea')!, ' Ten years of Fiore '));
    await save();

    expect(patches()).toHaveLength(1);
    expect(patches()[0]![2]!.body).toEqual({ bio: 'Ten years of Fiore' });
  });

  it('sends nothing again once his text is stored', async () => {
    serve({ ok: true, data: VIEW });
    await open();

    act(() => type(container.querySelector('textarea')!, 'Ten years of Fiore'));
    await save();
    await save();

    expect(patches()).toHaveLength(1);
  });

  it('shows the club line the organiser wrote meanwhile once his save lands', async () => {
    serve({ ok: true, data: VIEW });
    vi.mocked(apiRequest).mockImplementation(async (_base, path, init) => {
      if (path !== DETAILS) throw new Error(`unexpected request ${path}`);
      if (init?.method !== 'PATCH') return { ok: true, data: VIEW };
      return {
        ok: true,
        data: { ...VIEW.override, ...(init.body as object), club: 'Salle Paris' },
      };
    });
    await open();

    act(() => type(container.querySelector('textarea')!, 'Ten years of Fiore'));
    await save();

    const club = container.querySelector<HTMLInputElement>('input:not([type="file"])')!;
    expect(club.value).toBe('Salle Paris');
    expect(container.querySelector('textarea')!.value).toBe('Ten years of Fiore');
  });

  it('says so when his details cannot be read', async () => {
    serve({ ok: false, kind: 'http', status: 500, detail: null, code: null, details: null });
    await open();

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Your details for this workshop could not be read.',
    );
    expect(container.querySelector('textarea')).toBeNull();
  });
});
