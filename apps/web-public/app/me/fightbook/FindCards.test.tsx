// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { FindCard } from '@myclash/types';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../src/i18n/I18nProvider';
import { FindCards } from './FindCards';

/**
 * jsdom has no layout, so the narrow-phone wrap is held by the classes: the text block has its own
 * width to start from, so the Ask button drops to a line of its own instead of squeezing the name.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CARD = {
  fighter: {
    globalPersonId: '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01',
    name: 'Probe Fighter',
    photoUrl: null,
    club: null,
  },
  weapons: ['Longsword'],
} as unknown as FindCard;

let container: HTMLDivElement;
let root: Root;
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('FindCards', () => {
  it('gives the text block a basis so the card can wrap on a narrow phone', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root.render(
        <I18nProvider locale="en">
          <FindCards cards={[CARD]} apiUrl="http://api.test" onSent={() => undefined} />
        </I18nProvider>,
      ),
    );
    const card = container.querySelector('[data-find-card]')!;
    expect(card.className).toContain('flex-wrap');
    const text = card.querySelector('p')!.parentElement!;
    expect(text.className).toContain('basis-40');
    expect(text.className).toContain('flex-1');
  });
});
