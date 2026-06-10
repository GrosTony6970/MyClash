'use client';

import * as React from 'react';
import { fuzzyMatch } from '../utils/fuzzy-match';

export interface WeaponComboboxProps {
  /** Current value — free text. Whatever is typed IS the value. */
  value: string;
  onChange: (value: string) => void;
  /** Preset suggestions shown in the dropdown. */
  options: readonly string[];
  placeholder?: string;
  /** Shown when the typed text matches no preset (the custom value is kept). */
  emptyHint?: string;
  id?: string;
  'aria-label'?: string;
  /** Optional Tailwind classes applied to the outer wrapper. */
  className?: string;
}

/**
 * Free-text combobox: pick a preset from {@link WeaponComboboxProps.options}
 * OR type any custom value (which is preserved). Focusing shows the full list;
 * typing filters it with accent-insensitive token matching. Mirrors
 * {@link CountryCombobox} but, unlike it, the typed value is the model value —
 * there is no separate committed code, so custom entries survive.
 */
export function WeaponCombobox({
  value,
  onChange,
  options,
  placeholder,
  emptyHint,
  id,
  className = '',
  ...rest
}: WeaponComboboxProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  // false right after focus/select (show everything), true while the user
  // edits the text (filter live).
  const [typing, setTyping] = React.useState(false);
  const [highlight, setHighlight] = React.useState(0);
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);

  const filtered = React.useMemo(() => {
    if (!typing || !value.trim()) return options;
    return options.filter((o) => fuzzyMatch(value, o));
  }, [options, typing, value]);

  React.useEffect(() => {
    if (!open) return;
    function onDocClick(ev: MouseEvent) {
      if (!wrapperRef.current?.contains(ev.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLLIElement>(`[data-highlight="${highlight}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  function commit(option: string) {
    onChange(option);
    setOpen(false);
    setTyping(false);
    inputRef.current?.blur();
  }

  function onKeyDown(ev: React.KeyboardEvent<HTMLInputElement>) {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, Math.max(filtered.length - 1, 0)));
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (ev.key === 'Enter') {
      if (!open) return;
      ev.preventDefault();
      const opt = filtered[highlight];
      if (opt) commit(opt);
    } else if (ev.key === 'Escape') {
      setOpen(false);
      setTyping(false);
    }
  }

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-label={rest['aria-label']}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);
          setTyping(false);
          const idx = options.findIndex((o) => o === value);
          setHighlight(idx >= 0 ? idx : 0);
        }}
        onChange={(ev) => {
          onChange(ev.target.value);
          setOpen(true);
          setTyping(true);
          setHighlight(0);
        }}
        onKeyDown={onKeyDown}
        className="w-full rounded-md border border-slate-300 px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
      />
      {value && !open && (
        <button
          type="button"
          aria-label="Clear"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
        >
          ×
        </button>
      )}
      {open && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-500">{emptyHint ?? '—'}</li>
          ) : (
            filtered.map((opt, i) => (
              <li
                key={opt}
                data-highlight={i}
                role="option"
                aria-selected={value === opt}
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  commit(opt);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={[
                  'cursor-pointer px-3 py-2 text-sm',
                  i === highlight ? 'bg-red-50 text-red-900' : 'text-slate-700',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {opt}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
