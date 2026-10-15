'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { CSV_EXCEL_FR, CSV_STANDARD, csvFormatParam, type CsvFormat } from '@myclash/types';
import type { Translator } from '../types/translator';

/**
 * Download the server's CSV at `href` in `format` (`?csv=`), as a link to it would: the browser
 * sends the login, and the server's `Content-Disposition: attachment` keeps the page where it is.
 */
export function downloadServerCsv(href: string, format: Readonly<CsvFormat>): void {
  const link = document.createElement('a');
  link.href = `${href}?csv=${csvFormatParam(format)}`;
  link.click();
}

const CHOICES = [
  {
    format: CSV_EXCEL_FR,
    labelKey: 'common.csvExport.excelFrench',
    hintKey: 'common.csvExport.excelFrenchHint',
  },
  {
    format: CSV_STANDARD,
    labelKey: 'common.csvExport.standard',
    hintKey: 'common.csvExport.standardHint',
  },
] as const;

type Choice = (typeof CHOICES)[number];

export interface CsvExportMenuProps {
  label: string;
  className: string;
  disabled?: boolean;
  onExport: (format: CsvFormat) => void;
  /** The caller's translator. See src/types/translator.ts for why it is a prop. */
  t: Translator;
  /** The page's language: its file comes first. */
  locale: string;
}

/**
 * The focus left the button and its menu for an element outside, by Tab: the menu shuts. Not on
 * a blur to nothing: Safari does not focus a clicked button, so a click on the second choice
 * blurs the first to nothing, and the menu would shut under the click. A press outside is
 * `useOutsidePress`.
 */
function focusLeftFor(event: FocusEvent<HTMLDivElement>): boolean {
  const to = event.relatedTarget as Node | null;
  return to !== null && !event.currentTarget.contains(to);
}

/**
 * The CSV download of a page (operator, 2026-10-15): the page's own button opens a small menu
 * of the two files. French Excel splits on ";" and reads "12,50" as a number; English Excel and
 * the other apps want "," and "12.50". The file of the page's language comes first. Nothing is
 * remembered: both are offered at every download. `label` and `className` are the page's, so
 * each toolbar keeps its look. The download is the page's: a file it builds, or a link to the
 * server's (`csvFormatParam` names the file in the link).
 */
export function CsvExportMenu({
  label,
  className,
  disabled = false,
  onExport,
  t,
  locale,
}: CsvExportMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useOutsidePress(rootRef, open, () => setOpen(false));

  function shut() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div
      className="relative"
      ref={rootRef}
      onBlur={(event) => focusLeftFor(event) && setOpen(false)}
    >
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((was) => !was)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={className}
      >
        {label} <span aria-hidden>▾</span>
      </button>
      {open && (
        <Choices
          t={t}
          choices={locale === 'fr' ? CHOICES : [CHOICES[1], CHOICES[0]]}
          onPick={(format) => {
            shut();
            onExport(format);
          }}
          onEscape={shut}
        />
      )}
    </div>
  );
}

/** A press outside `root` while the menu is open shuts it. */
function useOutsidePress(root: RefObject<HTMLDivElement | null>, open: boolean, shut: () => void) {
  useEffect(() => {
    if (!open) return;
    function onPress(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) shut();
    }
    document.addEventListener('mousedown', onPress);
    return () => document.removeEventListener('mousedown', onPress);
  }, [root, open, shut]);
}

/** In the open menu, the arrows move between the choices, round; Escape shuts it. */
function onMenuKey(
  event: KeyboardEvent<HTMLDivElement>,
  items: ReadonlyArray<HTMLButtonElement | null>,
  onEscape: () => void,
) {
  if (event.key === 'Escape') {
    event.preventDefault();
    onEscape();
    return;
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  const at = items.indexOf(document.activeElement as HTMLButtonElement);
  const step = event.key === 'ArrowDown' ? 1 : -1;
  items[(at + step + items.length) % items.length]?.focus();
}

/** The open menu: it takes the focus on its first choice. */
function Choices({
  t,
  choices,
  onPick,
  onEscape,
}: {
  t: Translator;
  choices: readonly Choice[];
  onPick: (format: CsvFormat) => void;
  onEscape: () => void;
}) {
  const hintId = useId();
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => itemRefs.current[0]?.focus(), []);

  return (
    <div
      role="menu"
      tabIndex={-1}
      onKeyDown={(event) => onMenuKey(event, itemRefs.current, onEscape)}
      className="absolute right-0 top-full z-overlay mt-1 min-w-max rounded-md border border-border bg-surface py-1 shadow-xl"
    >
      {choices.map((choice, i) => (
        <button
          key={choice.labelKey}
          ref={(node) => {
            itemRefs.current[i] = node;
          }}
          type="button"
          role="menuitem"
          aria-describedby={`${hintId}-${i}`}
          onClick={() => onPick(choice.format)}
          className="block w-full px-3 py-2 text-left text-foreground transition-colors hover:bg-foreground/10 focus-visible:bg-foreground/10 focus-visible:outline-none"
        >
          <span className="block text-sm font-semibold">{t(choice.labelKey)}</span>
          <span id={`${hintId}-${i}`} className="block text-xs text-muted">
            {t(choice.hintKey)}
          </span>
        </button>
      ))}
    </div>
  );
}
