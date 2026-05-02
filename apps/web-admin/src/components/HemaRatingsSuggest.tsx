'use client';

import { useEffect, useState } from 'react';

export interface HemaRatingsSuggestion {
  id: string;
  name: string;
  club: string;
  detailsUrl: string;
}

interface HemaRatingsSuggestProps {
  apiUrl: string;
  personName: string;
  selectedId: string;
  onSelect: (suggestion: HemaRatingsSuggestion | null) => void;
}

export function HemaRatingsSuggest({
  apiUrl,
  personName,
  selectedId,
  onSelect,
}: HemaRatingsSuggestProps) {
  const [suggestions, setSuggestions] = useState<HemaRatingsSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = personName.trim();
    if (q.length < 2) {
      const timer = setTimeout(() => {
        setSuggestions([]);
        setError(null);
        setLoading(false);
      }, 0);
      return () => clearTimeout(timer);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      fetch(`${apiUrl}/api/v1/hema-ratings/search?q=${encodeURIComponent(q)}&limit=5`, {
        credentials: 'include',
        signal: controller.signal,
      })
        .then(async (res) => {
          if (!res.ok) throw new Error('HEMA Ratings search failed');
          setSuggestions((await res.json()) as HemaRatingsSuggestion[]);
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.name === 'AbortError') return;
          setSuggestions([]);
          setError('Unable to load HEMA Ratings suggestions.');
        })
        .finally(() => setLoading(false));
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [apiUrl, personName]);

  const selected = suggestions.find((s) => s.id === selectedId) ?? null;

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            HEMA Ratings
          </p>
          <p className="text-xs text-gray-500">Optional global fighter link</p>
        </div>
        {selected && (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="text-xs font-medium text-red-700 hover:text-red-800"
          >
            Clear
          </button>
        )}
      </div>

      {loading ? <p className="text-xs text-gray-400">Searching...</p> : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}

      {!loading && !error && suggestions.length === 0 ? (
        <p className="text-xs text-gray-500">No HEMA Ratings profile selected.</p>
      ) : null}

      {suggestions.length > 0 ? (
        <div className="space-y-1">
          {suggestions.map((suggestion) => {
            const active = suggestion.id === selectedId;
            return (
              <button
                key={suggestion.id}
                type="button"
                onClick={() => onSelect(suggestion)}
                className={[
                  'w-full rounded-md border px-3 py-2 text-left text-sm transition-colors',
                  active
                    ? 'border-red-700 bg-white text-gray-950 shadow-sm'
                    : 'border-transparent bg-white/70 text-gray-700 hover:border-gray-200 hover:bg-white',
                ].join(' ')}
              >
                <span className="flex items-start justify-between gap-3">
                  <span>
                    <span className="block font-medium">{suggestion.name}</span>
                    <span className="block text-xs text-gray-500">
                      {suggestion.club || 'No club listed'}
                    </span>
                  </span>
                  <span className="shrink-0 rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                    #{suggestion.id}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {selected ? (
        <a
          href={selected.detailsUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-xs font-medium text-red-700 hover:text-red-800"
        >
          Open HEMA Ratings profile
        </a>
      ) : null}
    </div>
  );
}
