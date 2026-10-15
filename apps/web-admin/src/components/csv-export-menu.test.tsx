import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CSV_EXCEL_FR, CSV_STANDARD, type CsvFormat } from '@myclash/types';
import { en } from '@myclash/i18n';
import { useI18n } from '@myclash/next-i18n/client';
import { CsvExportMenu, downloadServerCsv } from '@myclash/ui';
import { I18nProvider } from '@/i18n/I18nProvider';

/**
 * The CSV download asks which file (operator, 2026-10-15): French Excel splits on ";" and reads
 * "12,50"; English Excel and the other apps want "," and "12.50". One button opens a small menu;
 * the format of the page's language comes first; nothing is remembered.
 *
 * The menu lives in packages/ui, whose tests run with no DOM; it is driven here, as a page of
 * this app mounts it, its words and language handed in from the page's provider.
 */
let root: Root;
let container: HTMLDivElement;
let exported: CsvFormat[];

function AsAPage({ disabled }: { disabled: boolean }) {
  const { t, locale } = useI18n();
  return (
    <CsvExportMenu
      label={en.organizer.persons.export.button}
      className="trigger"
      disabled={disabled}
      onExport={(format) => exported.push(format)}
      t={t}
      locale={locale}
    />
  );
}

async function mount(locale: 'en' | 'fr', disabled = false) {
  await act(async () =>
    root.render(
      <I18nProvider locale={locale}>
        <p data-testid="outside" />
        <AsAPage disabled={disabled} />
      </I18nProvider>,
    ),
  );
}

const trigger = () => container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
const menu = () => container.querySelector('[role="menu"]');
const items = () => [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
const press = (key: string) =>
  act(async () => {
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  exported = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('CsvExportMenu', () => {
  it("shows the page's own button, its menu shut", async () => {
    await mount('en');
    expect(trigger().textContent).toContain('Export CSV');
    expect(trigger().className).toContain('trigger');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(menu()).toBeNull();
  });

  it('on a French page, offers the French Excel file first', async () => {
    await mount('fr');
    await act(async () => trigger().click());
    expect(items().map((item) => item.textContent)).toEqual([
      'Excel (français)Colonnes séparées par ; · décimales en 12,50',
      'Excel (anglais), autres logicielsColonnes séparées par , · décimales en 12.50',
    ]);
  });

  it('on an English page, offers the English file first', async () => {
    await mount('en');
    await act(async () => trigger().click());
    expect(items().map((item) => item.querySelector('span')!.textContent)).toEqual([
      'Excel (English), other apps',
      'Excel (French)',
    ]);
  });

  it('a pick downloads that file, shuts the menu and gives the focus back', async () => {
    await mount('en');
    await act(async () => trigger().click());
    await act(async () => items()[1]!.click());
    expect(exported).toEqual([CSV_EXCEL_FR]);
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());

    await act(async () => trigger().click());
    await act(async () => items()[0]!.click());
    expect(exported).toEqual([CSV_EXCEL_FR, CSV_STANDARD]);
  });

  it('opens on its first choice, and the arrows move between the two', async () => {
    await mount('en');
    await act(async () => trigger().click());
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(items()[0]);
    await press('ArrowDown');
    expect(document.activeElement).toBe(items()[1]);
    await press('ArrowDown');
    expect(document.activeElement).toBe(items()[0]);
    await press('ArrowUp');
    expect(document.activeElement).toBe(items()[1]);
  });

  it('Escape shuts the menu, downloads nothing, and gives the focus back', async () => {
    await mount('en');
    await act(async () => trigger().click());
    await press('Escape');
    expect(menu()).toBeNull();
    expect(exported).toEqual([]);
    expect(document.activeElement).toBe(trigger());
  });

  it('a press outside shuts the menu and downloads nothing', async () => {
    await mount('en');
    await act(async () => trigger().click());
    await act(async () => {
      container.querySelector('p')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(menu()).toBeNull();
    expect(exported).toEqual([]);
  });

  it('the focus leaving for another element shuts it; a blur to nothing does not', async () => {
    const after = document.body.appendChild(document.createElement('button'));
    await mount('en');
    await act(async () => trigger().click());
    // Safari does not focus a clicked button: the first choice then blurs to nothing.
    await act(async () => items()[0]!.blur());
    expect(menu()).not.toBeNull();

    await act(async () => trigger().focus());
    await act(async () => items()[0]!.focus());
    await act(async () => after.focus());
    expect(menu()).toBeNull();
    after.remove();
  });

  it('each choice is described by its hint, apart from its name', async () => {
    await mount('en');
    await act(async () => trigger().click());
    const first = items()[0]!;
    const hint = document.getElementById(first.getAttribute('aria-describedby')!);
    expect(hint?.textContent).toBe('Columns split by , · decimals as 12.50');
  });

  it('a second press of the button shuts the menu', async () => {
    await mount('en');
    await act(async () => trigger().click());
    await act(async () => trigger().click());
    expect(menu()).toBeNull();
  });

  it('a disabled button opens nothing', async () => {
    await mount('en', true);
    expect(trigger().disabled).toBe(true);
    await act(async () => trigger().click());
    expect(menu()).toBeNull();
  });
});

describe('downloadServerCsv', () => {
  it('names the file in the link, after any question the link already asks', () => {
    const opened: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      opened.push(this.href);
    });
    downloadServerCsv('http://api.test/report.csv', CSV_EXCEL_FR);
    downloadServerCsv('http://api.test/report.csv?group=open', CSV_STANDARD);
    expect(opened).toEqual([
      'http://api.test/report.csv?csv=excel-fr',
      'http://api.test/report.csv?group=open&csv=standard',
    ]);
    click.mockRestore();
  });
});
