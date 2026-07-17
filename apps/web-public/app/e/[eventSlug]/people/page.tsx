'use client';

/**
 * People search — T-611
 * Route: /e/[eventSlug]/people
 *
 * Fuzzy name lookup with role/club filters, debounced 250ms.
 * Result rows: name, club, role badges, next event time.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getPublicApiUrl } from '@/lib/api-url';
import { localeToBcp47 } from '@myclash/time';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useI18n } from '../../../../src/i18n/I18nProvider';

interface PersonResult {
  id: string;
  given_name: string;
  family_name: string;
  club_label: string | null;
  masked_email: string;
  roles: string[];
  nextEventLabel: string | null;
  nextEventAt: string | null;
}

const ROLE_COLORS: Record<string, string> = {
  competitor: 'bg-accent/10 text-accent border-accent/30',
  referee: 'bg-info/10 text-info border-info/30',
  workshop_lead: 'bg-warning/10 text-warning border-warning/30',
};

export default function PeoplePage() {
  const { t, locale } = useI18n();
  const params = useParams<{ eventSlug: string }>();
  const { eventSlug } = params;
  const apiUrl = getPublicApiUrl();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PersonResult[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const search = useCallback(
    async (q: string) => {
      if (q.trim().length < 2) {
        setResults([]);
        return;
      }
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      setLoading(true);
      try {
        const res = await fetch(
          `${apiUrl}/api/v1/events/${eventSlug}/persons/lookup?q=${encodeURIComponent(q)}`,
          { signal: abortRef.current.signal },
        );
        if (res.ok) setResults((await res.json()) as PersonResult[]);
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [eventSlug, apiUrl],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void search(query), 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, search]);

  return (
    <main className="px-4 py-6 max-w-lg mx-auto">
      <h1
        className="font-display font-bold text-2xl sm:text-3xl mb-4"
        style={{ fontFamily: 'var(--font-display)', color: 'var(--color-accent)' }}
      >
        {t('publicApp.people.title')}
      </h1>

      {/* Search input */}
      <div className="relative mb-4">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('publicApp.people.searchPlaceholder')}
          className="w-full bg-surface border border-border text-foreground placeholder:text-muted
                     px-4 py-3 text-base rounded-xl
                     focus:outline-none focus:ring-2 focus:border-transparent"
          style={{ '--tw-ring-color': 'var(--color-accent)' } as React.CSSProperties}
        />
        {loading && (
          <span className="absolute right-4 top-1/2 -translate-y-1/2">
            <span className="w-4 h-4 border-2 border-muted border-t-transparent rounded-full animate-spin inline-block" />
          </span>
        )}
      </div>

      {/* Results */}
      {results.length > 0 && (
        <ul className="flex flex-col gap-2">
          {results.map((p) => (
            <li key={p.id}>
              <Link href={`/e/${eventSlug}/people/${p.id}`}>
                <div className="bg-surface border border-border rounded-xl px-4 py-3 hover:border-muted transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <p className="font-semibold text-foreground">
                        {p.given_name} {p.family_name}
                      </p>
                      {p.club_label && <p className="text-xs text-muted mt-0.5">{p.club_label}</p>}
                      {/* Role badges */}
                      {p.roles && p.roles.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {p.roles.map((role) => (
                            <span
                              key={role}
                              className={[
                                'text-xs px-2 py-0.5 rounded-full border font-medium',
                                ROLE_COLORS[role] ?? 'bg-border text-muted border-border',
                              ].join(' ')}
                            >
                              {role.replace('_', ' ')}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* Next event */}
                    {p.nextEventLabel && (
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs text-muted">{p.nextEventLabel}</p>
                        {p.nextEventAt && (
                          <p className="text-xs text-muted">
                            {new Date(p.nextEventAt).toLocaleTimeString(localeToBcp47(locale), {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* Empty state */}
      {query.trim().length >= 2 && !loading && results.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted text-sm">
            {t('publicApp.people.noParticipantsFound', { query })}
          </p>
        </div>
      )}

      {/* Prompt */}
      {query.trim().length < 2 && (
        <p className="text-muted text-sm text-center py-8">
          {t('publicApp.people.minSearchChars')}
        </p>
      )}
    </main>
  );
}
