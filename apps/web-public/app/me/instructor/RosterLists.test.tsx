// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../src/i18n/I18nProvider';
import { RosterLists } from './InstructorDashboard';

/**
 * Paul teaches a Workshop and opens its roster on his phone. Beside a long name, the Present box
 * and the Refuse button ran off the card. They now sit on their own line, under the name.
 */
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

describe("the instructor's roster", () => {
  it('puts the Present box and the Refuse button on a line under the name', () => {
    act(() =>
      root.render(
        <I18nProvider locale="en">
          <RosterLists
            roster={[
              {
                id: 'b-1',
                status: 'confirmed',
                waitlistPosition: null,
                personId: 'p-1',
                guest: true,
                checkedInAt: null,
                persons: { id: 'p-1', givenName: 'Yane', familyName: 'Li Ah Chong', clubs: null },
              },
            ]}
            busyId={null}
            onModerate={() => undefined}
            onTick={() => undefined}
          />
        </I18nProvider>,
      ),
    );

    const line = container.querySelector('li')!;
    expect(line.className).toContain('flex-col');
    const [name, controls] = [...line.children];
    expect(name!.textContent).toContain('Yane Li Ah Chong');
    expect(name!.querySelector('button, input')).toBeNull();
    expect(controls!.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(controls!.querySelector('button')!.textContent).toBe('Refuse');
  });
});
