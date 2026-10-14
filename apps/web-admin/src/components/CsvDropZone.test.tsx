import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '@/i18n/I18nProvider';
import { CsvDropZone } from './CsvDropZone';

/**
 * The box of a CSV import (O18, ruled 2026-10-14): a dropped `.csv` is taken; another file
 * is refused with its name and the reason; several at once are refused. The drop and the
 * drag-over both stop the browser's own handling, or it opens the file in place of the page.
 */
let root: Root;
let container: HTMLDivElement;
let picked: File | null;

function Box() {
  const [file, setFile] = useState<File | null>(null);
  return (
    <CsvDropZone
      file={file}
      onFile={(next) => {
        picked = next;
        setFile(next);
      }}
    />
  );
}

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  picked = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <I18nProvider locale="en">
        <Box />
      </I18nProvider>,
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const zone = () => container.querySelector<HTMLElement>('[data-testid="csv-drop-zone"]')!;
const csv = (name = 'roster.csv') => new File(['given_name\n'], name, { type: 'text/csv' });

/** A drag event as the browser sends it; true when nothing prevented its default. */
async function send(type: 'dragover' | 'drop', files: File[] = []): Promise<boolean> {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files, types: ['Files'] } });
  let notPrevented = true;
  await act(async () => {
    notPrevented = zone().dispatchEvent(event);
  });
  return notPrevented;
}

describe('the box of a CSV import', () => {
  it('takes a dropped .csv, and stops the browser from opening it', async () => {
    expect(await send('dragover')).toBe(false);
    expect(await send('drop', [csv('Roster.CSV')])).toBe(false);
    expect(picked?.name).toBe('Roster.CSV');
    expect(zone().textContent).toContain('Roster.CSV');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('refuses another file, with its name and the reason, and keeps the file picked', async () => {
    await send('drop', [csv()]);
    await send('drop', [new File(['x'], 'roster.xlsx')]);
    expect(picked?.name).toBe('roster.csv');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      '“roster.xlsx” is not a .csv file. Save it as CSV first.',
    );
  });

  it('refuses several files dropped at once', async () => {
    await send('drop', [csv('a.csv'), csv('b.csv')]);
    expect(picked).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Drop one file at a time.');
  });

  it('refuses a file of another kind from the picker too, and clears the refusal on a .csv', async () => {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const choose = async (file: File) => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    };
    await choose(new File(['x'], 'photo.png'));
    expect(picked).toBeNull();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await choose(csv());
    expect(picked?.name).toBe('roster.csv');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
