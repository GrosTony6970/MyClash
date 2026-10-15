'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest } from '@myclash/api-client';
import { CsvExportMenu, downloadServerCsv } from '@myclash/ui';
import { getPublicApiUrl } from '@/lib/api-url';
import { useTournamentChoice } from '@/hooks/useTournamentChoice';
import { BackLink } from '@/components/BackLink';
import { useEventStatus } from '../_hooks/useEventStatus';
import { RestoreArchiveForm } from './RestoreArchiveForm';

type ArchiveScope = 'event' | 'tournament';
type ArchiveInclude = 'structure' | 'scoring';
type ArchiveFormat = 'zip' | 'json';

/** One Tournament's three CSVs, each asking which file (operator, 2026-10-15). */
const TOURNAMENT_CSVS = [
  { file: 'matches.csv', labelKey: 'organizer.archive.downloadMatches' },
  { file: 'exchanges.csv', labelKey: 'organizer.archive.downloadExchanges' },
  { file: 'rankings.csv', labelKey: 'organizer.archive.downloadRankings' },
] as const;

const DOWNLOAD_CLASS =
  'rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground';

interface EventInfo {
  id: string;
  name: string;
  slug: string;
  status: string;
  organization_id?: string;
}

interface Tournament {
  id: string;
  slug: string;
  name: string;
  status: string;
}

export default function OrganizerArchivePage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const apiUrl = getPublicApiUrl();
  const { t, locale } = useI18n();
  const { isArchived } = useEventStatus(eventId);

  const [event, setEvent] = useState<EventInfo | null>(null);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [scope, setScope] = useState<ArchiveScope>('event');
  const [include, setInclude] = useState<ArchiveInclude>('scoring');
  const [format, setFormat] = useState<ArchiveFormat>('zip');
  const [selectedTournamentId, setSelectedTournamentId] = useTournamentChoice(
    eventId,
    tournaments.map((tournament) => tournament.id),
  );
  // The three CSVs below are one Tournament's even under "Whole Event": they say whose.
  const csvOf = {
    tournament: tournaments.find((tour) => tour.id === selectedTournamentId)?.name ?? '',
  };

  useEffect(() => {
    const controller = new AbortController();
    // Tolerant, as before: the export links draw from whatever landed and the
    // restore half below reports its own failures.
    void Promise.all([
      apiRequest<EventInfo>(apiUrl, `/api/v1/events/${eventId}`, { signal: controller.signal }),
      apiRequest<Tournament[]>(apiUrl, `/api/v1/events/${eventId}/tournaments`, {
        signal: controller.signal,
      }),
    ]).then(([eventRes, tournamentsRes]) => {
      if (eventRes.ok) setEvent(eventRes.data);
      if (tournamentsRes.ok) setTournaments(tournamentsRes.data);
    });
    return () => controller.abort();
  }, [apiUrl, eventId]);

  const exportHref =
    scope === 'event'
      ? `${apiUrl}/api/v1/events/${eventId}/archive?format=${format}&include=${include}`
      : `${apiUrl}/api/v1/tournaments/${selectedTournamentId}/archive?format=${format}&include=${include}`;

  return (
    <main className="mx-auto p-8 max-w-2xl">
      <BackLink
        href={`/org/${slug}/events/${eventId}`}
        label={t('organizer.archive.backToEvent')}
        className="mb-2"
      />

      <header className="mb-6">
        <h1 className="font-display font-bold text-2xl sm:text-3xl">
          {t('organizer.archive.title')}
        </h1>
        <p className="text-sm text-muted mt-1">{t('organizer.archive.description')}</p>
      </header>

      <section className="mb-6 rounded-lg border border-border p-4">
        <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
          {t('organizer.archive.exportTitle')}
        </h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <Field label={t('organizer.archive.scope')}>
            <select
              value={scope}
              aria-label={t('organizer.archive.scope')}
              onChange={(changeEvent) => setScope(changeEvent.target.value as ArchiveScope)}
              className="w-full rounded-md border border-border px-3 py-2 text-sm"
            >
              <option value="event">{t('organizer.archive.scopes.event')}</option>
              <option value="tournament">{t('organizer.archive.scopes.tournament')}</option>
            </select>
          </Field>
          <Field label={t('organizer.archive.content')}>
            <select
              value={include}
              aria-label={t('organizer.archive.content')}
              onChange={(changeEvent) => setInclude(changeEvent.target.value as ArchiveInclude)}
              className="w-full rounded-md border border-border px-3 py-2 text-sm"
            >
              <option value="structure">{t('organizer.archive.includes.structure')}</option>
              <option value="scoring">{t('organizer.archive.includes.scoring')}</option>
            </select>
          </Field>
          <Field label={t('organizer.archive.format')}>
            <select
              value={format}
              aria-label={t('organizer.archive.format')}
              onChange={(changeEvent) => setFormat(changeEvent.target.value as ArchiveFormat)}
              className="w-full rounded-md border border-border px-3 py-2 text-sm"
            >
              <option value="zip">{t('organizer.archive.formats.zip')}</option>
              <option value="json">{t('organizer.archive.formats.json')}</option>
            </select>
          </Field>
        </div>

        {scope === 'tournament' && (
          <div className="mt-4">
            <Field label={t('organizer.archive.tournament')}>
              <select
                value={selectedTournamentId}
                aria-label={t('organizer.archive.tournament')}
                onChange={(changeEvent) => setSelectedTournamentId(changeEvent.target.value)}
                className="w-full rounded-md border border-border px-3 py-2 text-sm"
              >
                {tournaments.map((tournament) => (
                  <option key={tournament.id} value={tournament.id}>
                    {tournament.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-3">
          <a
            href={exportHref}
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground"
          >
            {t('organizer.archive.downloadArchive')}
          </a>
          {selectedTournamentId &&
            TOURNAMENT_CSVS.map(({ file, labelKey }) => (
              <CsvExportMenu
                key={file}
                t={t}
                locale={locale}
                label={t(labelKey, csvOf)}
                onExport={(csvFormat) =>
                  downloadServerCsv(
                    `${apiUrl}/api/v1/tournaments/${selectedTournamentId}/exports/${file}`,
                    csvFormat,
                  )
                }
                className={DOWNLOAD_CLASS}
              />
            ))}
          <CsvExportMenu
            t={t}
            locale={locale}
            label={t('organizer.archive.downloadFullCsv')}
            onExport={(csvFormat) =>
              downloadServerCsv(`${apiUrl}/api/v1/events/${eventId}/exports/full.csv`, csvFormat)
            }
            className={DOWNLOAD_CLASS}
          />
          <a
            href={`${apiUrl}/api/v1/events/${eventId}/exports/full.json`}
            className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground"
          >
            {t('organizer.archive.downloadFullJson')}
          </a>
        </div>

        <p className="mt-4 text-sm text-muted">
          {t('organizer.archive.hemaRatingsHint')}{' '}
          <Link
            href={`/org/${slug}/events/${eventId}/hema-ratings`}
            className="font-semibold text-accent underline"
          >
            {t('organizer.archive.hemaRatingsLink')}
          </Link>
        </p>
      </section>

      <RestoreArchiveForm
        eventId={eventId}
        organizationId={event?.organization_id}
        isArchived={isArchived}
      />
    </main>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="block">
      <span className="mb-1 block text-xs font-medium uppercase text-muted">{label}</span>
      {children}
    </div>
  );
}
