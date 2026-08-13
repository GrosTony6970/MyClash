'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { useEventStatus } from '../_hooks/useEventStatus';
import { getPublicApiUrl } from '@/lib/api-url';

interface EventClub {
  id: string;
  name: string;
  abbreviation: string | null;
  city: string | null;
  country_code: string | null;
  logo_url: string | null;
  unverified: string | null;
  eventFighterCount: number;
  fighters: Array<{
    id: string;
    givenName: string;
    familyName: string;
    email: string;
    claimStatus: string;
    inEvent: boolean;
  }>;
}

type ClubScope = 'all' | 'event';

const emptyClubRequest = {
  name: '',
  abbreviation: '',
  city: '',
  countryCode: '',
  website: '',
  logoUrl: '',
};

export default function EventClubsPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const apiUrl = getPublicApiUrl();
  const { t } = useI18n();
  const { isReadOnly } = useEventStatus(eventId);

  return (
    <main className="mx-auto max-w-[110rem] p-6 lg:p-8">
      <div className="mb-6 flex items-center gap-2 text-sm text-muted">
        <Link href={`/org/${slug}`} className="hover:text-info">
          {slug}
        </Link>
        <span>/</span>
        <Link href={`/org/${slug}/events/${eventId}`} className="hover:text-info">
          {t('organizer.shell.nav.eventOverview')}
        </Link>
        <span>/</span>
        <span className="font-medium text-foreground">{t('organizer.shell.nav.clubs')}</span>
      </div>
      <h1 className="mb-6 font-display font-bold text-2xl sm:text-3xl text-foreground">
        {t('organizer.shell.nav.clubs')}
      </h1>
      <EventClubsSection apiUrl={apiUrl} eventId={eventId} isReadOnly={isReadOnly} />
    </main>
  );
}

function EventClubsSection({
  apiUrl,
  eventId,
  isReadOnly,
}: {
  apiUrl: string;
  eventId: string;
  isReadOnly: boolean;
}) {
  const { t } = useI18n();
  const [scope, setScope] = useState<ClubScope>('event');
  const [query, setQuery] = useState('');
  const [clubs, setClubs] = useState<EventClub[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Set of club ids whose fighter list is unfolded inline below their
  // row. Multiple clubs may stay open at once so the operator can
  // compare rosters without re-clicking.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  function toggleExpanded(clubId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(clubId)) next.delete(clubId);
      else next.add(clubId);
      return next;
    });
  }
  const [form, setForm] = useState(emptyClubRequest);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const loadClubs = useCallback(
    async (nextScope = scope, nextQuery = query, signal?: AbortSignal) => {
      setLoading(true);
      const params = new URLSearchParams({ scope: nextScope });
      if (nextQuery.trim()) params.set('q', nextQuery.trim());
      const response = await fetch(`${apiUrl}/api/v1/events/${eventId}/clubs?${params}`, {
        credentials: 'include',
        signal,
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        const detail = body?.message ? `: ${body.message}` : '';
        throw new Error(`${t('organizer.eventHub.clubs.loadError')} (${response.status})${detail}`);
      }
      setClubs((await response.json()) as EventClub[]);
      setError(null);
      setLoading(false);
    },
    [apiUrl, eventId, query, scope, t],
  );

  useEffect(() => {
    const controller = new AbortController();
    Promise.resolve()
      .then(() => loadClubs(scope, query, controller.signal))
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : t('common.error'));
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [loadClubs, query, scope, t]);

  async function submitClubRequest() {
    if (!form.name.trim()) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`${apiUrl}/api/v1/events/${eventId}/club-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: form.name.trim(),
          abbreviation: form.abbreviation.trim() || undefined,
          city: form.city.trim() || undefined,
          countryCode: form.countryCode.trim() || undefined,
          website: form.website.trim() || undefined,
          logoUrl: form.logoUrl.trim() || undefined,
        }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? t('organizer.eventHub.clubs.submitError'));
      }
      setForm(emptyClubRequest);
      setSuccess(t('organizer.eventHub.clubs.submitSuccess'));
      await loadClubs(scope, query);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizer.eventHub.clubs.submitError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mb-8 rounded-lg border border-border bg-surface shadow-sm">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
          {t('organizer.eventHub.clubs.title')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('organizer.eventHub.clubs.description')}</p>
      </div>

      <div className="border-b border-border px-5 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex w-fit rounded-lg border border-border bg-background p-1">
            {(['all', 'event'] as ClubScope[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setScope(item)}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
                  scope === item
                    ? 'bg-surface text-info shadow-sm'
                    : 'text-muted hover:text-foreground'
                }`}
              >
                {item === 'all'
                  ? t('organizer.eventHub.clubs.allClubs')
                  : t('organizer.eventHub.clubs.eventClubs')}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <input
              aria-label={t('organizer.eventHub.clubs.searchLabel')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('organizer.eventHub.clubs.searchPlaceholder')}
              className="w-full rounded-md border border-border px-3 py-2 text-sm lg:w-80"
            />
            <button
              type="button"
              onClick={() => void loadClubs(scope, query)}
              disabled={loading}
              className="rounded-md bg-info px-4 py-2 text-sm font-semibold text-info-foreground hover:bg-info-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:opacity-50"
            >
              {t('actions.search')}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-5 mt-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}
      {success && (
        <div className="mx-5 mt-4 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
          {success}
        </div>
      )}

      <div className="overflow-x-auto px-5 py-4">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-[0.14em] text-muted">
            <tr>
              <th className="py-2">{t('organizer.eventHub.clubs.club')}</th>
              <th className="py-2">{t('organizer.eventHub.clubs.location')}</th>
              <th className="py-2">{t('organizer.eventHub.clubs.status')}</th>
              <th className="py-2">{t('organizer.eventHub.clubs.eventFighters')}</th>
              <th className="py-2">{t('organizer.eventHub.clubs.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {clubs.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-muted">
                  {loading ? t('common.loading') : t('organizer.eventHub.clubs.empty')}
                </td>
              </tr>
            )}
            {clubs.map((club) => {
              const expanded = expandedIds.has(club.id);
              return (
                <Fragment key={club.id}>
                  <tr className="border-t border-border">
                    <td className="py-3 pr-4">
                      <div className="font-semibold text-foreground">{club.name}</div>
                      <div className="text-xs text-muted">{club.abbreviation ?? '-'}</div>
                    </td>
                    <td className="py-3 pr-4 text-foreground-secondary">
                      {[club.city, club.country_code].filter(Boolean).join(', ') || '-'}
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          club.unverified === 'true'
                            ? 'bg-warning/10 text-warning'
                            : 'bg-success/10 text-success'
                        }`}
                      >
                        {club.unverified === 'true'
                          ? t('organizer.eventHub.clubs.unverified')
                          : t('organizer.eventHub.clubs.verified')}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-foreground-secondary">
                      {club.eventFighterCount}
                    </td>
                    <td className="py-3">
                      {club.eventFighterCount > 0 ? (
                        <button
                          type="button"
                          onClick={() => toggleExpanded(club.id)}
                          aria-expanded={expanded}
                          className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-info hover:bg-info/10"
                        >
                          {expanded
                            ? t('organizer.eventHub.clubs.hideFighters')
                            : t('organizer.eventHub.clubs.viewFighters')}
                        </button>
                      ) : (
                        <span className="text-xs text-muted">
                          {t('organizer.eventHub.clubs.noEventFighters')}
                        </span>
                      )}
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="bg-background">
                      <td colSpan={5} className="px-3 pb-4">
                        <div className="rounded-lg border border-border bg-background p-4">
                          <div className="mb-3 flex items-start justify-between gap-3">
                            <div>
                              <h3 className="font-semibold text-foreground">
                                {t('organizer.eventHub.clubs.fightersFor', { club: club.name })}
                              </h3>
                              <p className="mt-0.5 text-xs text-muted">
                                {t('organizer.eventHub.clubs.fightersCountSummary', {
                                  inEvent: String(club.fighters.filter((f) => f.inEvent).length),
                                  other: String(club.fighters.filter((f) => !f.inEvent).length),
                                })}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => toggleExpanded(club.id)}
                              className="text-xs font-semibold text-muted hover:text-foreground"
                            >
                              {t('actions.close')}
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                            {club.fighters.map((fighter) => (
                              <div
                                key={fighter.id}
                                className={[
                                  'rounded-md border p-2 text-sm',
                                  fighter.inEvent
                                    ? 'border-success/30 bg-surface'
                                    : 'border-dashed border-border bg-background/50',
                                ].join(' ')}
                              >
                                <div className="flex items-center justify-between gap-1">
                                  <span
                                    className={[
                                      'truncate font-semibold',
                                      fighter.inEvent ? 'text-foreground' : 'text-muted',
                                    ].join(' ')}
                                  >
                                    {fighter.givenName} {fighter.familyName}
                                  </span>
                                  {fighter.inEvent && (
                                    <span className="shrink-0 rounded bg-success/10 px-1.5 py-0.5 text-[10px] font-semibold text-success">
                                      {t('organizer.eventHub.clubs.fighterInEvent')}
                                    </span>
                                  )}
                                </div>
                                {fighter.email && (
                                  <div className="truncate text-[10px] text-muted">
                                    {fighter.email}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="border-t border-border px-5 py-5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
          {t('organizer.eventHub.clubs.submitTitle')}
        </h3>
        <p className="mt-1 text-sm text-muted">{t('organizer.eventHub.clubs.submitHelp')}</p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {[
            ['name', t('organizer.eventHub.clubs.nameRequired')],
            ['abbreviation', t('organizer.eventHub.clubs.abbreviation')],
            ['city', t('organizer.eventHub.clubs.city')],
            ['countryCode', t('organizer.eventHub.clubs.country')],
            ['website', t('organizer.eventHub.clubs.website')],
            ['logoUrl', t('organizer.eventHub.clubs.logoUrl')],
          ].map(([field, label]) => {
            const fieldName = field as keyof typeof form;
            return (
              <label key={field} className="text-xs font-semibold text-foreground-secondary">
                {label}
                <input
                  value={form[fieldName]}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, [fieldName]: event.target.value }))
                  }
                  maxLength={field === 'countryCode' ? 100 : undefined}
                  className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                />
              </label>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => void submitClubRequest()}
          disabled={submitting || !form.name.trim() || isReadOnly}
          title={isReadOnly ? t('organizer.deletionRequest.archivedReadOnly') : undefined}
          className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:opacity-50"
        >
          {submitting
            ? t('organizer.eventHub.clubs.submitting')
            : t('organizer.eventHub.clubs.submit')}
        </button>
      </div>
    </section>
  );
}
