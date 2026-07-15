'use client';

import { useEffect, useState } from 'react';
import { DataTable, DataTableCell, DataTableHead, DataTableRow } from '@myclash/ui';
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
          setError(t('admin.common.hemaSuggestLoadFailed'));
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
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">
            {t('admin.srcComponents.hemaRatingsTitle')}
          </p>
          <p className="text-xs text-muted">{t('admin.srcComponents.hemaRatingsSubtitle')}</p>
        </div>
        {selected && (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="text-xs font-medium text-danger hover:text-danger-hover"
          >
            {t('admin.srcComponents.hemaRatingsClear')}
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-xs text-muted">{t('admin.srcComponents.hemaRatingsSearching')}</p>
      ) : null}
      {error ? <p className="text-xs text-danger">{error}</p> : null}

      {!loading && !error && suggestions.length === 0 ? (
        <p className="text-xs text-muted">{t('admin.srcComponents.hemaRatingsNoProfile')}</p>
      ) : null}

      {suggestions.length > 0 ? (
        <DataTable>
          <DataTableHead>
            <DataTableCell as="th">{t('organizer.persons.hemaFinder.colName')}</DataTableCell>
            <DataTableCell as="th">{t('organizer.persons.hemaFinder.colClub')}</DataTableCell>
            <DataTableCell as="th">{t('organizer.persons.hemaFinder.colCountry')}</DataTableCell>
            <DataTableCell as="th">{t('organizer.persons.hemaFinder.colId')}</DataTableCell>
          </DataTableHead>
          <tbody>
            {suggestions.map((suggestion) => {
              const active = suggestion.id === selectedId;
              return (
                <DataTableRow
                  key={suggestion.id}
                  onClick={() => handleSelect(suggestion)}
                  className={['cursor-pointer', active ? 'bg-accent/10 text-foreground' : ''].join(
                    ' ',
                  )}
                >
                  <DataTableCell className="font-medium">{suggestion.name}</DataTableCell>
                  <DataTableCell className="text-xs text-muted">
                    {suggestion.club || '—'}
                  </DataTableCell>
                  <DataTableCell className="text-xs text-muted">
                    {suggestion.nationality || '—'}
                  </DataTableCell>
                  <DataTableCell className="text-xs text-muted">#{suggestion.id}</DataTableCell>
                </DataTableRow>
              );
            })}
          </tbody>
        </DataTable>
      ) : null}
    </div>
  );
}
