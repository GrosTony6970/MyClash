'use client';

import * as React from 'react';
import { fuzzyMatch } from '../utils/fuzzy-match';
import { formatCountryName, getCountryOptions, type CountryOption } from '../lib/countries';

export interface CountryComboboxProps {
  value: string | null;
  onChange: (code: string | null) => void;
  locale: string;
  placeholder?: string;
  'aria-label'?: string;
  id?: string;
  /** Optional Tailwind classes applied to the outer wrapper. */
  className?: string;
}

/**
 * Searchable combobox of ISO 3166-1 alpha-2 country codes. France
 * sits at the top with a thin divider; the rest of the world is
 * alphabetical by localised name. Typing fuzz-matches with
 * accent-insensitive comparison.
 */
export function CountryCombobox({
  value,
  onChange,
  locale,
  placeholder,
  id,
  className = '',
  ...rest
}: CountryComboboxProps): React.JSX.Element {
  const options = React.useMemo(() => getCountryOptions(locale), [locale]);
  const selectedName = React.useMemo(() => formatCountryName(value, locale), [value, locale]);

  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [highlight, setHighlight] = React.useState(0);
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);

  const filtered = React.useMemo(() => {
    if (!query.trim()) return options;
    return options.filter((o) => fuzzyMatch(query, o.name));
  }, [options, query]);

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

  function commit(opt: CountryOption | null) {
    onChange(opt?.code ?? null);
    setQuery('');
    setOpen(false);
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
      setQuery('');
    }
  }

  const displayValue = open ? query : (selectedName ?? '');

  // Track where the pinned-block ends so we can render a divider after it.
  const lastPinnedIndex = React.useMemo(
    () => filtered.reduce((acc, o, i) => (o.pinned ? i : acc), -1),
    [filtered],
  );

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
        value={displayValue}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);
          setHighlight(0);
        }}
        onChange={(ev) => {
          setQuery(ev.target.value);
          setOpen(true);
          setHighlight(0);
        }}
        onKeyDown={onKeyDown}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
      />
      {value && !open && (
        <button
          type="button"
          aria-label="Clear country"
          onClick={() => commit(null)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        >
          ×
        </button>
      )}
      {open && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute z-overlay mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-500">No country matches</li>
          ) : (
            filtered.map((opt, i) => (
              <li
                key={opt.code}
                data-highlight={i}
                role="option"
                aria-selected={value === opt.code}
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  commit(opt);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={[
                  'cursor-pointer px-3 py-2 text-sm',
                  i === highlight ? 'bg-red-50 text-red-900' : 'text-gray-700',
                  i === lastPinnedIndex && i < filtered.length - 1
                    ? 'border-b border-gray-200'
                    : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {opt.name}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
