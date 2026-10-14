import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openPrintWindow } from './print-window';

/** Every source file under `app`, for the sweep. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !name.includes('.test.') ? [path] : [];
  });
}

/**
 * Two of the five print doors (the workshop board, the schedule board) are mounted by no
 * test. This holds that every door tells the organiser the window was blocked, in the
 * shared words, and that no door opens a print window of its own again.
 */
describe('the print doors', () => {
  const root = join(__dirname, '../../app');
  const files = sources(root).map((path) => ({ path, text: readFileSync(path, 'utf8') }));

  it('each say the window was blocked, in the shared words', () => {
    const doors = files.filter(({ text }) => text.includes('openPrintWindow('));
    expect(doors.length).toBe(5);
    for (const { path, text } of doors) {
      const calls = text.split('openPrintWindow(').length - 1;
      const said = text.split("t('organizer.printWindow.popupBlocked')").length - 1;
      expect(said, relative(root, path)).toBe(calls);
    }
  });

  it('none opens a window of its own', () => {
    const own = files.filter(({ text }) => text.includes('window.open('));
    expect(own.map(({ path }) => relative(root, path))).toEqual([]);
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('openPrintWindow', () => {
  it('says so when the browser blocks the window, and prints nothing', () => {
    vi.stubGlobal('open', () => null);
    const blocked = vi.fn();
    openPrintWindow('<p>ranking</p>', blocked);
    expect(blocked).toHaveBeenCalledTimes(1);
  });

  it('writes the page, closes the document, then prints', () => {
    const calls: string[] = [];
    const doc = {
      write: (html: string) => calls.push(`write ${html}`),
      close: () => calls.push('close'),
    };
    const w = { document: doc, focus: () => calls.push('focus'), print: () => calls.push('print') };
    vi.stubGlobal('open', () => w);
    const blocked = vi.fn();
    openPrintWindow('<p>ranking</p>', blocked);
    expect(calls).toEqual(['write <p>ranking</p>', 'close', 'focus', 'print']);
    expect(blocked).not.toHaveBeenCalled();
  });
});
