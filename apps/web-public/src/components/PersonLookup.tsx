'use client';

/**
 * PersonLookup.tsx — T-603
 *
 * Debounced name search against /api/v1/events/:id/persons/lookup.
 * Shows name, club, masked email. Retries 3× with backoff on network error.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';

export interface PersonMatch {
  id: string;
  given_name: string;
  family_name: string;
  club_label: string | null;
  masked_email: string;
}

export interface PersonLookupProps {
  eventId: string;
  apiUrl: string;
  onSelect: (person: PersonMatch) => void;
  onNotInList: () => void;
  placeholder?: string;
}

const DEBOUNCE_MS = 250;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [500, 1000, 2000]; // ms

async function fetchWithRetry(url: string, retries = MAX_RETRIES): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      return res;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt] ?? 2000));
    }
  }
  throw new Error('Max retries exceeded');
}

export function PersonLookup({
  eventId,
  apiUrl,
  onSelect,
  onNotInList,
  placeholder = 'Type your name…',
}: PersonLookupProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PersonMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const search = useCallback(
    async (q: string) => {
      if (q.trim().length < 2) {
        setResults([]);
        return;
      }

      // Cancel previous request
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      setLoading(true);
      setError(null);

      try {
        const url = `${apiUrl}/api/v1/events/${eventId}/persons/lookup?q=${encodeURIComponent(q)}`;
        const res = await fetchWithRetry(url);

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as PersonMatch[];
        setResults(data);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError('Search failed. Check your connection.');
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [eventId, apiUrl],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void search(query);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, search]);

  const showResults = query.trim().length >= 2;

  return (
    <div className="flex flex-col gap-3">
      {/* Search input */}
      <div className="relative">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          className="w-full bg-gray-900 border border-gray-700 text-white placeholder-gray-500
                     px-4 py-3 text-lg rounded-xl
                     focus:outline-none focus:ring-2 focus:border-transparent"
          style={{ '--tw-ring-color': 'var(--event-primary, #c0392b)' } as React.CSSProperties}
          aria-label={t('publicApp.personLookup.searchAria')}
          aria-autocomplete="list"
        />
        {loading && (
          <span className="absolute right-4 top-1/2 -translate-y-1/2">
            <span className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin inline-block" />
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}

      {/* Results */}
      {showResults && (
        <ul className="flex flex-col gap-2">
          {results.map((person) => (
            <li key={person.id}>
              <button
                onClick={() => onSelect(person)}
                className="w-full text-left bg-gray-900 border border-gray-700 rounded-xl px-4 py-3
                           hover:border-gray-500 active:bg-gray-800 transition-colors"
              >
                <p className="font-semibold text-white">
                  {person.given_name} {person.family_name}
                </p>
                <p className="text-sm text-gray-400 mt-0.5">
                  {person.club_label && <span className="mr-2">{person.club_label}</span>}
                  <span className="font-mono text-xs">{person.masked_email}</span>
                </p>
              </button>
            </li>
          ))}

          {/* Not in list CTA — always shown when results visible */}
          <li>
            <button
              onClick={onNotInList}
              className="w-full text-left px-4 py-3 text-gray-500 hover:text-gray-300
                         border border-dashed border-gray-800 rounded-xl transition-colors text-sm"
            >
              {t('publicApp.personLookup.notInList')}
            </button>
          </li>
        </ul>
      )}

      {/* No results state */}
      {showResults && !loading && results.length === 0 && !error && (
        <div className="text-center py-6">
          <p className="text-gray-400 text-sm mb-3">
            {t('publicApp.personLookup.noMatchesFound', { query })}
          </p>
          <button
            onClick={onNotInList}
            className="text-sm text-gray-500 hover:text-gray-300 underline"
          >
            {t('publicApp.personLookup.notInListShort')}
          </button>
        </div>
      )}
    </div>
  );
}
