'use client';

/**
 * People search — T-611
 * Route: /e/[eventSlug]/people
 *
 * Fuzzy name lookup, debounced 250ms. Result rows: name, club, role badges
 * (`publicRolesOf` on the server, operator ruling 2026-10-16).
 *
 * A read that fails says so and offers Try again: it said "No participants
 * found", as if nobody of that name were there.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getPublicApiUrl } from '@/lib/api-url';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useI18n } from '@myclash/next-i18n/client';
import { NotFoundCard } from '@/components/NotFoundCard';
import { personRoleWord, type PersonRole } from '@/lib/person-roles';
import { fetchEventInfo } from '../_components/EventHeader';

interface PersonResult {
  id: string;
  given_name: string;
  family_name: string;
  club_label: string | null;
  roles: PersonRole[];
}

const ROLE_COLORS: Record<PersonRole, string> = {
  competitor: 'bg-accent/10 text-accent border-accent/30',
  referee: 'bg-info/10 text-info border-info/30',
  instructor: 'bg-warning/10 text-warning border-warning/30',
};

/** The Event's id once read (the lookup takes the id, ruling 121a), or why there is none. */
type EventState =
  { kind: 'loading' } | { kind: 'found'; id: string } | { kind: 'notFound' | 'failed' };

export default function PeoplePage() {
  const { t } = useI18n();
  const params = useParams<{ eventSlug: string }>();
  const { eventSlug } = params;
  const apiUrl = getPublicApiUrl();

  const [event, setEvent] = useState<EventState>({ kind: 'loading' });
  const [eventAsked, setEventAsked] = useState(0);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PersonResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const eventId = event.kind === 'found' ? event.id : null;

  useEffect(() => {
    void fetchEventInfo(eventSlug, apiUrl, { credentials: 'include' }).then((read) =>
      setEvent(read.kind === 'found' ? { kind: 'found', id: read.event.id } : { kind: read.kind }),
    );
  }, [eventSlug, apiUrl, eventAsked]);

  const search = useCallback(
    async (q: string) => {
      setSearchFailed(false);
      if (q.trim().length < 2 || !eventId) {
        setResults([]);
        return;
      }
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      setLoading(true);
      try {
        // With the login: a club member searches her own draft Event.
        const res = await fetch(
          `${apiUrl}/api/v1/events/${eventId}/persons/lookup?q=${encodeURIComponent(q)}`,
          { signal: abortRef.current.signal, credentials: 'include' },
        );
        if (!res.ok) throw new Error(`lookup ${res.status}`);
        setResults((await res.json()) as PersonResult[]);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setResults([]);
        setSearchFailed(true);
      } finally {
        setLoading(false);
      }
    },
    [eventId, apiUrl],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void search(query), 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, search]);

  // An Event the visitor may not read, or none: the site's "not found", which renews a lapsed login.
  if (event.kind === 'notFound') return <NotFoundCard renewLogin />;
  const failed = event.kind === 'failed' || searchFailed;
  const tryAgain = () => {
    if (event.kind !== 'failed') return void search(query);
    setEvent({ kind: 'loading' });
    setEventAsked((n) => n + 1);
  };

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
          aria-label={t('publicApp.people.searchPlaceholder')}
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

      {failed && (
        <div role="alert" className="rounded-xl border border-danger/40 bg-danger/10 p-4 text-sm">
          <p className="text-foreground">{t('publicApp.people.searchFailed')}</p>
          <button
            type="button"
            onClick={tryAgain}
            className="mt-3 min-h-11 rounded-lg border border-border px-3 text-sm font-semibold text-foreground transition-colors hover:border-muted"
          >
            {t('common.identityRetry')}
          </button>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <ul className="flex flex-col gap-2">
          {results.map((p) => (
            <li key={p.id}>
              <Link href={`/e/${eventSlug}/people/${p.id}`}>
                <div className="bg-surface border border-border rounded-xl px-4 py-3 hover:border-muted transition-colors">
                  <p className="font-semibold text-foreground">
                    {p.given_name} {p.family_name}
                  </p>
                  {p.club_label && <p className="text-xs text-muted mt-0.5">{p.club_label}</p>}
                  {p.roles.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {p.roles.map((role) => (
                        <span
                          key={role}
                          className={`text-xs px-2 py-0.5 rounded-full border font-medium ${ROLE_COLORS[role]}`}
                        >
                          {personRoleWord(role, t)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* Empty state: only for a search that ran and found no one */}
      {query.trim().length >= 2 && eventId && !loading && !failed && results.length === 0 && (
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
