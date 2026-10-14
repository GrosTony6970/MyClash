import { afterEach, describe, expect, it, vi } from 'vitest';
import { openPrintWindow } from './print-window';

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
