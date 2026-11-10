// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../src/i18n/I18nProvider';
import { EditPanel } from './InstructorDashboard';

/**
 * Ruling 557: Paul, who teaches "Dagger intro", writes its catalogue line and its prerequisites
 * from his dashboard, beside the description, level, language and weapon he already edits. An
 * emptied box is sent as null, which clears it.
 */
vi.mock('../../../src/hooks/useWeaponOptions', () => ({ useWeaponOptions: () => [] }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

/** Types into a React-controlled field the way a browser does. */
function type(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = Object.getPrototypeOf(field) as object;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

const labelled = (text: string) =>
  [...container.querySelectorAll('label')]
    .find((label) => label.textContent?.startsWith(text))!
    .querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea')!;

describe("the instructor's edit panel", () => {
  it('sends the catalogue line and the prerequisites, an emptied one as null', async () => {
    const onSaved = vi.fn();
    act(() =>
      root.render(
        <I18nProvider locale="en">
          <EditPanel
            workshopId="w-1"
            apiUrl="http://api.test"
            fields={{
              weapon: '',
              level: '',
              language: 'en',
              descriptionMd: '',
              shortDescription: 'First steps',
              prerequisites: '',
            }}
            onSaved={onSaved}
          />
        </I18nProvider>,
      ),
    );

    act(() => type(labelled('Short description'), ''));
    act(() => type(labelled('Prerequisites'), ' Bring a mask '));
    const save = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Save')!;
    await act(async () => save.click());

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/api/v1/workshops/w-1/instructor');
    expect(JSON.parse(String(init.body))).toMatchObject({
      shortDescription: null,
      prerequisites: 'Bring a mask',
    });
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ shortDescription: '', prerequisites: ' Bring a mask ' }),
    );
  });
});
