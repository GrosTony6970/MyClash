// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../../../../src/i18n/I18nProvider';
import type { WorkshopGridBlock as BlockModel } from '../_lib/workshop-grid-data';
import { WorkshopGridBlock } from './WorkshopGridBlock';

/**
 * Ruling 552 on the public grid: "Longsword basics" was cancelled at 10:00 in the Hall and
 * "Dagger intro" took the room. Each card takes half the cell, Dagger on the left; a card alone in
 * its room keeps the whole cell.
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const block = (lane: BlockModel['lane'], cancelled: boolean): BlockModel => ({
  workshopId: 'w-1',
  sessionId: 's-1',
  title: cancelled ? 'Longsword basics' : 'Dagger intro',
  columnKey: 'hall',
  startSlot: 24,
  endSlot: 36,
  span: 12,
  startsAt: '2027-06-05T08:00:00.000Z',
  endsAt: '2027-06-05T09:00:00.000Z',
  category: null,
  level: null,
  capacity: 12,
  color: null,
  instructorNames: [],
  confirmedCount: 0,
  cancelled,
  lane,
  dayIndex: 0,
  href: '/e/fal/w/w-1',
});

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

function card(model: BlockModel): HTMLAnchorElement {
  act(() =>
    root.render(
      <I18nProvider locale="en">
        <WorkshopGridBlock block={model} startHour={8} rowFor={(slot) => slot + 3} gridColumn={2} />
      </I18nProvider>,
    ),
  );
  return container.querySelector('a')!;
}

describe('a Workshop card on the public grid', () => {
  it('takes the left half when it is the live card beside a cancelled one', () => {
    const style = card(block('start', false)).style;
    expect(style.width).toBe('calc(50% - 2px)');
    expect(style.justifySelf).toBe('start');
  });

  it('takes the right half when it is the cancelled card', () => {
    const style = card(block('end', true)).style;
    expect(style.width).toBe('calc(50% - 2px)');
    expect(style.justifySelf).toBe('end');
  });

  it('keeps the whole cell when it is alone in its room and hour', () => {
    const style = card(block(null, false)).style;
    expect(style.width).toBe('');
    expect(style.justifySelf).toBe('');
  });
});

/**
 * Quiet by colour, not by fade (known-deviations D29). A cancelled card was the Workshop's colour
 * at 60%, and its small lines at 70% of that: 1.8:1 to 3.1:1. It is now the neutral slate pair at
 * full ink, struck through; every line of a card reads at full ink.
 */
describe('a cancelled Workshop card', () => {
  const cancelled = { ...block(null, true), color: 'teal', category: 'Longsword', level: 'Open' };

  it('turns neutral grey instead of fading', () => {
    const classes = Array.from(card(cancelled).classList);
    expect(classes).toEqual(expect.arrayContaining(['bg-slate-50', 'text-slate-600']));
    expect(classes).not.toContain('bg-teal-50');
    expect(classes).not.toContain('opacity-60');
  });

  it('keeps the colour of a live card', () => {
    const classes = Array.from(card({ ...cancelled, cancelled: false }).classList);
    expect(classes).toEqual(expect.arrayContaining(['bg-teal-50', 'text-teal-700']));
  });

  it('fades no line of the card', () => {
    const faded = Array.from(card(cancelled).querySelectorAll('*')).filter((el) =>
      Array.from(el.classList).some((c) => /^opacity-\d+$/.test(c)),
    );
    expect(faded).toEqual([]);
  });
});
