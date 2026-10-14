import { describe, expect, it, vi } from 'vitest';
import { createDialogLayers } from './dialog-layers';

/** O25 (ruled 2026-10-14): Escape closes the top dialog only. */

function press(target: EventTarget, key = 'Escape', handled = false): Event {
  const event = Object.assign(new Event('keydown', { cancelable: true }), { key });
  if (handled) event.preventDefault();
  target.dispatchEvent(event);
  return event;
}

describe('dialog layers', () => {
  it('hands one Escape to the top layer only, then the next to the one under it', () => {
    const page = new EventTarget();
    const layers = createDialogLayers(page);
    const window = vi.fn();
    const question = vi.fn();
    const closeWindow = layers.open(window);
    const closeQuestion = layers.open(question);

    expect(press(page).defaultPrevented).toBe(true);
    expect(question).toHaveBeenCalledTimes(1);
    expect(window).not.toHaveBeenCalled();

    closeQuestion();
    press(page);
    expect(window).toHaveBeenCalledTimes(1);
    expect(question).toHaveBeenCalledTimes(1);
    closeWindow();
  });

  it('leaves another key, and an Escape a control already took, alone', () => {
    const page = new EventTarget();
    const layers = createDialogLayers(page);
    const top = vi.fn();
    layers.open(top);
    expect(press(page, 'Enter').defaultPrevented).toBe(false);
    press(page, 'Escape', true);
    expect(top).not.toHaveBeenCalled();
  });

  it('keeps a lower layer in place when it closes out of order', () => {
    const page = new EventTarget();
    const layers = createDialogLayers(page);
    const first = vi.fn();
    const second = vi.fn();
    const closeFirst = layers.open(first);
    layers.open(second);
    closeFirst();
    closeFirst();
    press(page);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(layers.count()).toBe(1);
  });

  it('listens only while a layer is open', () => {
    const page = new EventTarget();
    const add = vi.spyOn(page, 'addEventListener');
    const remove = vi.spyOn(page, 'removeEventListener');
    const layers = createDialogLayers(page);
    const close = layers.open(vi.fn());
    layers.open(vi.fn())();
    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
    close();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(press(page).defaultPrevented).toBe(false);
  });
});
