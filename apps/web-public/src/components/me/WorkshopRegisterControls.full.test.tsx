// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkshopRegisterControls, registerLabels } from './WorkshopRegisterControls';

/**
 * Joris's Messer session is full. He switched its waiting list off (0280): Léa, who finds the
 * session full, reads a dead "Full" button instead of "Join waitlist". With the switch on, she
 * may still queue.
 */
vi.mock('next/link', () => ({ default: () => null }));

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

const t = (key: string) => key;

function draw(waitlistEnabled: boolean) {
  const onRegister = vi.fn();
  act(() =>
    root.render(
      <WorkshopRegisterControls
        workshopId="w-5"
        booking="none"
        full
        waitlistEnabled={waitlistEnabled}
        labels={registerLabels(t)}
        onRegister={onRegister}
      />,
    ),
  );
  return container.querySelector('button')!;
}

describe('a full session', () => {
  it('offers no waiting list when the Workshop keeps none', () => {
    const button = draw(false);
    expect(button.textContent).toBe('publicApp.me.workshops.fullClosed');
    expect(button.disabled).toBe(true);
  });

  it('offers the waiting list when the Workshop keeps one', () => {
    const button = draw(true);
    expect(button.textContent).toBe('publicApp.me.workshops.joinWaitlist');
    expect(button.disabled).toBe(false);
  });
});
