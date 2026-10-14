import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePrompt, type PromptOptions } from '@myclash/ui';

/**
 * O27 (ruled 2026-10-14): `PromptDialog` names its field, checks the value as it is typed (the
 * reason under the field, Confirm off) and can show a masked value. It lives in `@myclash/ui`,
 * which has no DOM to test in, and is reached here through `usePrompt`, as pages reach it.
 */
const OPTIONS: PromptOptions = {
  title: 'New PIN for Ana',
  fieldLabel: 'New PIN',
  masked: true,
  revealable: { show: 'Show PIN', hide: 'Hide PIN' },
  validate: (value) => (value.length < 6 ? 'Six digits at least.' : null),
  confirmLabel: 'Reset PIN',
  cancelLabel: 'Cancel',
};

let ask: (options: PromptOptions) => Promise<string | null>;
function Probe() {
  const { prompt, promptDialog } = usePrompt();
  useEffect(() => {
    ask = prompt;
  });
  return <>{promptDialog}</>;
}

let container: HTMLDivElement;
let root: Root;

const field = () => document.body.querySelector<HTMLInputElement>('[role="dialog"] input')!;
const button = (label: string) =>
  [...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
    (b) => b.textContent === label,
  )!;
function typeIn(value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field(), value);
    field().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<Probe />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('a prompt that checks what is typed', () => {
  it('names its field, and says why while Confirm stays off', () => {
    void act(() => void ask(OPTIONS));
    const label = document.body.querySelector('[role="dialog"] label')!;
    expect(label.textContent).toBe('New PIN');
    expect(label.getAttribute('for')).toBe(field().id);
    expect(document.body.textContent).not.toContain('Six digits at least.');

    typeIn('123');
    expect(document.body.textContent).toContain('Six digits at least.');
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(button('Reset PIN').disabled).toBe(true);

    typeIn('482916');
    expect(document.body.textContent).not.toContain('Six digits at least.');
    expect(button('Reset PIN').disabled).toBe(false);
  });

  it('shows and hides a masked value', () => {
    void act(() => void ask(OPTIONS));
    expect(field().type).toBe('password');
    act(() => button('Show PIN').click());
    expect(field().type).toBe('text');
    act(() => button('Hide PIN').click());
    expect(field().type).toBe('password');
  });

  it('hands back what was typed once it passes', async () => {
    let answer: Promise<string | null> = Promise.resolve(null);
    act(() => {
      answer = ask(OPTIONS);
    });
    typeIn('482916');
    const done = vi.fn();
    void answer.then(done);
    await act(async () => button('Reset PIN').click());
    expect(done).toHaveBeenCalledWith('482916');
  });
});
