'use client';

import * as React from 'react';
import { fuzzyMatch } from '../utils/fuzzy-match';

export interface ClubOption {
  id: string;
  name: string;
  city?: string | null;
  abbreviation?: string | null;
}

/** A club selection: `clubId` set when an existing club is picked; null + a
 *  `clubName` when the user is creating a new club by typing a free name. */
export interface ClubValue {
  clubId: string | null;
  clubName: string;
}

export interface ClubComboboxProps {
  value: ClubValue | null;
  onChange: (value: ClubValue | null) => void;
  /** Caller-supplied search (wires the `GET /clubs?q=&searchAbv=true` fetch). */
  searchClubs: (query: string) => Promise<ClubOption[]>;
  placeholder?: string;
  /** When true, offer a "+ create" row for the typed text with no exact match. */
  allowCreate?: boolean;
  /** i18n'd label for the create row, given the typed text. */
  createLabel?: (query: string) => string;
  /** i18n'd "no matches" text. */
  noMatchLabel?: string;
  'aria-label'?: string;
  clearLabel?: string;
  id?: string;
  className?: string;
}

/**
 * Tokenized, async, fuzzy club picker — modeled on `CountryCombobox` but driven
 * by a caller-supplied `searchClubs` so `@myclash/ui` stays free of API/URL
 * knowledge. Offers "create new club" for unmatched text (the API resolves the
 * name → an unverified club on save). i18n strings are passed in by the caller.
 */
export function ClubCombobox({
  value,
  onChange,
  searchClubs,
  placeholder,
  allowCreate = true,
  createLabel = (q) => `Create “${q}”`,
  noMatchLabel = 'No clubs match',
  clearLabel = 'Clear club',
  id,
  className = '',
  ...rest
}: ClubComboboxProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [options, setOptions] = React.useState<ClubOption[]>([]);
  const [highlight, setHighlight] = React.useState(0);
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Debounced async search while the menu is open.
  React.useEffect(() => {
    if (!open) return;
    const q = query.trim();
    let cancelled = false;
    const handle = setTimeout(() => {
      void searchClubs(q)
        .then((res) => {
          if (!cancelled) setOptions(res);
        })
        .catch(() => {
          if (!cancelled) setOptions([]);
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query, open, searchClubs]);

  React.useEffect(() => {
    if (!open) return;
    function onDocClick(ev: MouseEvent) {
      if (!wrapperRef.current?.contains(ev.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const trimmed = query.trim();
  const filtered = React.useMemo(
    () =>
      trimmed
        ? options.filter((o) => fuzzyMatch(trimmed, `${o.name} ${o.abbreviation ?? ''}`))
        : options,
    [options, trimmed],
  );
  const exactMatch = filtered.some((o) => o.name.toLowerCase() === trimmed.toLowerCase());
  const showCreate = allowCreate && trimmed.length > 0 && !exactMatch;
  const rows = filtered.length + (showCreate ? 1 : 0);

  function commitOption(opt: ClubOption) {
    onChange({ clubId: opt.id, clubName: opt.name });
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  }
  function commitCreate() {
    if (!trimmed) return;
    onChange({ clubId: null, clubName: trimmed });
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  }

  function onKeyDown(ev: React.KeyboardEvent<HTMLInputElement>) {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, Math.max(rows - 1, 0)));
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (ev.key === 'Enter') {
      if (!open) return;
      ev.preventDefault();
      if (highlight < filtered.length) {
        const opt = filtered[highlight];
        if (opt) commitOption(opt);
      } else if (showCreate) {
        commitCreate();
      }
    } else if (ev.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  }

  const displayValue = open ? query : (value?.clubName ?? '');

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
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 pr-8 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
      />
      {value && !open && (
        <button
          type="button"
          aria-label={clearLabel}
          onClick={() => onChange(null)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
        >
          ×
        </button>
      )}
      {open && (
        <ul
          role="listbox"
          className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-surface shadow-lg"
        >
          {rows === 0 ? (
            <li className="px-3 py-2 text-sm text-muted">{noMatchLabel}</li>
          ) : (
            <>
              {filtered.map((opt, i) => (
                <li
                  key={opt.id}
                  role="option"
                  aria-selected={value?.clubId === opt.id}
                  onMouseDown={(ev) => {
                    ev.preventDefault();
                    commitOption(opt);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  className={[
                    'flex cursor-pointer items-center gap-2 px-3 py-2 text-sm',
                    i === highlight ? 'bg-accent/10 text-foreground' : 'text-foreground/90',
                  ].join(' ')}
                >
                  <span className="truncate">{opt.name}</span>
                  {opt.abbreviation && (
                    <span className="ml-auto rounded bg-foreground/10 px-1.5 py-0.5 text-[11px] text-muted">
                      {opt.abbreviation}
                    </span>
                  )}
                </li>
              ))}
              {showCreate && (
                <li
                  role="option"
                  aria-selected={false}
                  onMouseDown={(ev) => {
                    ev.preventDefault();
                    commitCreate();
                  }}
                  onMouseEnter={() => setHighlight(filtered.length)}
                  className={[
                    'flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-semibold text-accent',
                    highlight === filtered.length ? 'bg-accent/10' : '',
                  ].join(' ')}
                >
                  <span aria-hidden="true">+</span>
                  {createLabel(trimmed)}
                </li>
              )}
            </>
          )}
        </ul>
      )}
    </div>
  );
}
