'use client';

import { useEffect, useState } from 'react';
import { t } from '@myclash/i18n';

export interface HemaRatingsSuggestion {
  id: string;
  name: string;
  club: string;
  nationality: string | null;
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

  /**
   * Fire-and-forget background sync of the picked fighter. Keepalive
   * keeps the POST alive if the user closes the participant modal
   * immediately after selecting. Errors are silenced — the snapshot
   * refresh is a nice-to-have, not a precondition for saving the
   * participant.
   */
  function handleSelect(suggestion: HemaRatingsSuggestion) {
    fetch(`${apiUrl}/api/v1/hema-ratings/fighters/${suggestion.id}/sync`, {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
    }).catch(() => {});
    onSelect(suggestion);
  }

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
        <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                <th className="px-2 py-1.5">{t('organizer.persons.hemaFinder.colName')}</th>
                <th className="px-2 py-1.5">{t('organizer.persons.hemaFinder.colClub')}</th>
                <th className="px-2 py-1.5">{t('organizer.persons.hemaFinder.colCountry')}</th>
                <th className="px-2 py-1.5">{t('organizer.persons.hemaFinder.colId')}</th>
              </tr>
            </thead>
            <tbody>
              {suggestions.map((suggestion) => {
                const active = suggestion.id === selectedId;
                return (
                  <tr
                    key={suggestion.id}
                    onClick={() => handleSelect(suggestion)}
                    className={[
                      'cursor-pointer border-b border-gray-100 transition-colors last:border-b-0',
                      active ? 'bg-red-50 text-gray-950' : 'hover:bg-gray-50 text-gray-700',
                    ].join(' ')}
                  >
                    <td className="px-2 py-1.5 font-medium">{suggestion.name}</td>
                    <td className="px-2 py-1.5 text-xs text-gray-500">{suggestion.club || '—'}</td>
                    <td className="px-2 py-1.5 text-xs text-gray-500">
                      {suggestion.nationality || '—'}
                    </td>
                    <td className="px-2 py-1.5 text-xs text-gray-500">#{suggestion.id}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
