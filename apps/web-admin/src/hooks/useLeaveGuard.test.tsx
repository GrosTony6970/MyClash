import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLeaveGuard } from '@myclash/ui';

/**
 * The leave question of `@myclash/ui` (M4, then O12 and O15, ruled 2026-10-14). It lives in
 * the shared package, which has no DOM to test in; web-admin is its first organiser caller.
 */

const t = (key: string) => key;
const navigate = vi.fn<(href: string) => void>();

let ask: () => Promise<boolean>;
function Probe({ dirty }: { dirty: boolean }) {
  const { askToLeave, confirmDialog } = useLeaveGuard(dirty, { t, navigate });
  useEffect(() => {
    ask = askToLeave;
  });
  return <>{confirmDialog}</>;
}

let container: HTMLDivElement;
let root: Root;
let link: HTMLAnchorElement;

function render(dirty: boolean) {
  act(() => root.render(<Probe dirty={dirty} />));
}

/** A plain left click on a link to another page of the site. Returns whether it was stopped. */
function clickLink(): boolean {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
  act(() => {
    link.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

const question = () => document.body.querySelector('[role="dialog"]');
function press(label: string) {
  const button = [...document.body.querySelectorAll('button')].find((b) => b.textContent === label);
  if (!button) throw new Error(`no button "${label}"`);
  act(() => button.click());
}

beforeEach(() => {
  navigate.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  link = document.createElement('a');
  link.href = '/org/club/events';
  document.body.appendChild(link);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  link.remove();
});

describe('useLeaveGuard', () => {
  it('asks before a link leaves a page with unsaved edits, and Stay keeps the page', async () => {
    render(true);
    expect(clickLink()).toBe(true);
    expect(question()?.textContent).toContain('common.leaveGuard.title');
    press('common.leaveGuard.stay');
    await act(async () => {});
    expect(question()).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('goes to the link once Leave is pressed', async () => {
    render(true);
    clickLink();
    press('common.leaveGuard.leave');
    await act(async () => {});
    expect(navigate).toHaveBeenCalledWith('/org/club/events');
  });

  it('asks the browser before the tab closes, only while edits are unsaved', () => {
    render(true);
    const dirtyUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyUnload);
    expect(dirtyUnload.defaultPrevented).toBe(true);

    render(false);
    const cleanUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanUnload);
    expect(cleanUnload.defaultPrevented).toBe(false);
  });

  it('lets a clean page go with no question', async () => {
    render(false);
    expect(clickLink()).toBe(false);
    expect(question()).toBeNull();
    await expect(ask()).resolves.toBe(true);
    expect(question()).toBeNull();
  });
});
