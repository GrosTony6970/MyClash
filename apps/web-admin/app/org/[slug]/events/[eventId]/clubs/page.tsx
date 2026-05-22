'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../../../../../../src/i18n/I18nProvider';
import { useEventStatus } from '../_hooks/useEventStatus';

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
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const { t } = useI18n();
  const { isReadOnly } = useEventStatus(eventId);

  return (
    <main className="p-6 lg:p-8">
      <div className="mb-6 flex items-center gap-2 text-sm text-slate-500">
        <Link href={`/org/${slug}`} className="hover:text-[#1d4ed8]">
          {slug}
        </Link>
        <span>/</span>
        <Link href={`/org/${slug}/events/${eventId}`} className="hover:text-[#1d4ed8]">
          {t('organizer.shell.nav.eventOverview')}
        </Link>
        <span>/</span>
        <span className="font-medium text-[#0f172a]">{t('organizer.shell.nav.clubs')}</span>
      </div>
      <h1 className="mb-6 text-3xl font-bold text-[#0f172a]">{t('organizer.shell.nav.clubs')}</h1>
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
  const [selectedClub, setSelectedClub] = useState<EventClub | null>(null);
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
    <section className="mb-8 rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
          {t('organizer.eventHub.clubs.title')}
        </h2>
        <p className="mt-1 text-sm text-slate-500">{t('organizer.eventHub.clubs.description')}</p>
      </div>

      <div className="border-b border-slate-100 px-5 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex w-fit rounded-lg border border-slate-200 bg-slate-50 p-1">
            {(['all', 'event'] as ClubScope[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setScope(item)}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
                  scope === item
                    ? 'bg-white text-[#1d4ed8] shadow-sm'
                    : 'text-slate-500 hover:text-slate-900'
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
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm lg:w-80"
            />
            <button
              type="button"
              onClick={() => void loadClubs(scope, query)}
              disabled={loading}
              className="rounded-md bg-[#1d4ed8] px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {t('actions.search')}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-5 mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="mx-5 mt-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {success}
        </div>
      )}

      <div className="overflow-x-auto px-5 py-4">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-[0.14em] text-slate-500">
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
                <td colSpan={5} className="py-8 text-center text-slate-400">
                  {loading ? t('common.loading') : t('organizer.eventHub.clubs.empty')}
                </td>
              </tr>
            )}
            {clubs.map((club) => (
              <tr key={club.id} className="border-t border-slate-100">
                <td className="py-3 pr-4">
                  <div className="font-semibold text-[#0f172a]">{club.name}</div>
                  <div className="text-xs text-slate-500">{club.abbreviation ?? '-'}</div>
                </td>
                <td className="py-3 pr-4 text-slate-600">
                  {[club.city, club.country_code].filter(Boolean).join(', ') || '-'}
                </td>
                <td className="py-3 pr-4">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      club.unverified === 'true'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-green-100 text-green-700'
                    }`}
                  >
                    {club.unverified === 'true'
                      ? t('organizer.eventHub.clubs.unverified')
                      : t('organizer.eventHub.clubs.verified')}
                  </span>
                </td>
                <td className="py-3 pr-4 text-slate-700">{club.eventFighterCount}</td>
                <td className="py-3">
                  {club.eventFighterCount > 0 ? (
                    <button
                      type="button"
                      onClick={() => setSelectedClub(club)}
                      className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#1d4ed8] hover:bg-blue-50"
                    >
                      {t('organizer.eventHub.clubs.viewFighters')}
                    </button>
                  ) : (
                    <span className="text-xs text-slate-400">
                      {t('organizer.eventHub.clubs.noEventFighters')}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedClub && (
        <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-[#0f172a]">
                {t('organizer.eventHub.clubs.fightersFor', { club: selectedClub.name })}
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                {t('organizer.eventHub.clubs.fightersCountSummary', {
                  inEvent: String(selectedClub.fighters.filter((f) => f.inEvent).length),
                  other: String(selectedClub.fighters.filter((f) => !f.inEvent).length),
                })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedClub(null)}
              className="text-xs font-semibold text-slate-500 hover:text-slate-900"
            >
              {t('actions.close')}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {selectedClub.fighters.map((fighter) => (
              <div
                key={fighter.id}
                className={[
                  'rounded-md border p-2 text-sm',
                  fighter.inEvent
                    ? 'border-emerald-200 bg-white'
                    : 'border-dashed border-slate-200 bg-slate-50/50',
                ].join(' ')}
              >
                <div className="flex items-center justify-between gap-1">
                  <span
                    className={[
                      'truncate font-semibold',
                      fighter.inEvent ? 'text-slate-900' : 'text-slate-500',
                    ].join(' ')}
                  >
                    {fighter.givenName} {fighter.familyName}
                  </span>
                  {fighter.inEvent && (
                    <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                      {t('organizer.eventHub.clubs.fighterInEvent')}
                    </span>
                  )}
                </div>
                {fighter.email && (
                  <div className="truncate text-[10px] text-slate-400">{fighter.email}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-slate-100 px-5 py-5">
        <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
          {t('organizer.eventHub.clubs.submitTitle')}
        </h3>
        <p className="mt-1 text-sm text-slate-500">{t('organizer.eventHub.clubs.submitHelp')}</p>
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
              <label key={field} className="text-xs font-semibold text-slate-600">
                {label}
                <input
                  value={form[fieldName]}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, [fieldName]: event.target.value }))
                  }
                  maxLength={field === 'countryCode' ? 100 : undefined}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
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
          className="mt-4 rounded-md bg-[#dc2626] px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
        >
          {submitting
            ? t('organizer.eventHub.clubs.submitting')
            : t('organizer.eventHub.clubs.submit')}
        </button>
      </div>
    </section>
  );
}
