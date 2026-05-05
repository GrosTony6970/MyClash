'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { ReactNode } from 'react';
import { useI18n } from '../../../../../../src/i18n/I18nProvider';

type ArchiveScope = 'event' | 'tournament';
type ArchiveInclude = 'structure' | 'scoring';
type ArchiveFormat = 'zip' | 'json';

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

interface RestorePreview {
  scope: ArchiveScope;
  include: ArchiveInclude;
  source: {
    eventName: string;
    tournamentName?: string;
  };
  counts: Record<string, number>;
  warnings: string[];
  canRestore: boolean;
}

const RESTORE_CONFIRMATION = 'RESTORE MYCLASH ARCHIVE';

export default function OrganizerArchivePage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [event, setEvent] = useState<EventInfo | null>(null);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [scope, setScope] = useState<ArchiveScope>('event');
  const [include, setInclude] = useState<ArchiveInclude>('scoring');
  const [format, setFormat] = useState<ArchiveFormat>('zip');
  const [selectedTournamentId, setSelectedTournamentId] = useState('');
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch(`${apiUrl}/api/v1/events/${eventId}`, {
        credentials: 'include',
        signal: controller.signal,
      }),
      fetch(`${apiUrl}/api/v1/events/${eventId}/tournaments`, {
        credentials: 'include',
        signal: controller.signal,
      }),
    ])
      .then(async ([eventRes, tournamentsRes]) => {
        if (eventRes.ok) setEvent((await eventRes.json()) as EventInfo);
        if (tournamentsRes.ok) {
          const nextTournaments = (await tournamentsRes.json()) as Tournament[];
          setTournaments(nextTournaments);
          setSelectedTournamentId(nextTournaments[0]?.id ?? '');
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [apiUrl, eventId]);

  const exportHref =
    scope === 'event'
      ? `${apiUrl}/api/v1/events/${eventId}/archive?format=${format}&include=${include}`
      : `${apiUrl}/api/v1/tournaments/${selectedTournamentId}/archive?format=${format}&include=${include}`;

  const previewRestore = (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError(t('organizer.archive.uploadMissing'));
      return;
    }
    const formData = new FormData();
    formData.set('file', file);
    setBusy(true);
    setError(null);
    setNotice(null);
    fetch(`${apiUrl}/api/v1/archive/restore-preview`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(t('organizer.archive.previewError'));
        setPreview((await res.json()) as RestorePreview);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : t('organizer.archive.previewError')),
      )
      .finally(() => setBusy(false));
  };

  const restoreArchive = () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError(t('organizer.archive.uploadMissing'));
      return;
    }
    const params = new URLSearchParams({ confirmation });
    if (preview?.scope === 'event' && event?.organization_id) {
      params.set('targetOrganizationId', event.organization_id);
    }
    if (preview?.scope === 'tournament') params.set('targetEventId', eventId);
    const formData = new FormData();
    formData.set('file', file);
    setBusy(true);
    setError(null);
    setNotice(null);
    fetch(`${apiUrl}/api/v1/archive/restore?${params.toString()}`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(t('organizer.archive.restoreError'));
        setNotice(t('organizer.archive.restoreStarted'));
        setConfirmation('');
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : t('organizer.archive.restoreError')),
      )
      .finally(() => setBusy(false));
  };

  return (
    <main id="main-content" className="p-8 max-w-5xl">
      <div className="mb-2">
        <Link
          href={`/org/${slug}/events/${eventId}`}
          className="text-sm text-gray-500 hover:underline"
        >
          {t('organizer.archive.backToEvent')}
        </Link>
      </div>

      <header className="mb-6">
        <h1 className="text-2xl font-bold">{t('organizer.archive.title')}</h1>
        <p className="text-sm text-gray-500 mt-1">{t('organizer.archive.description')}</p>
      </header>

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <section className="mb-6 rounded-lg border border-gray-200 p-4">
        <h2 className="text-base font-semibold text-gray-950">
          {t('organizer.archive.exportTitle')}
        </h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <Field label={t('organizer.archive.scope')}>
            <select
              value={scope}
              aria-label={t('organizer.archive.scope')}
              onChange={(changeEvent) => setScope(changeEvent.target.value as ArchiveScope)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
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
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
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
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
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
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
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
            className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white"
          >
            {t('organizer.archive.downloadArchive')}
          </a>
          {selectedTournamentId && (
            <>
              <a
                href={`${apiUrl}/api/v1/tournaments/${selectedTournamentId}/exports/matches.csv`}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-900"
              >
                {t('organizer.archive.downloadMatches')}
              </a>
              <a
                href={`${apiUrl}/api/v1/tournaments/${selectedTournamentId}/exports/exchanges.csv`}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-900"
              >
                {t('organizer.archive.downloadExchanges')}
              </a>
              <a
                href={`${apiUrl}/api/v1/tournaments/${selectedTournamentId}/exports/rankings.csv`}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-900"
              >
                {t('organizer.archive.downloadRankings')}
              </a>
            </>
          )}
        </div>
      </section>

      <form onSubmit={previewRestore} className="rounded-lg border border-gray-200 p-4">
        <h2 className="text-base font-semibold text-gray-950">
          {t('organizer.archive.restoreTitle')}
        </h2>
        <p className="mt-1 text-sm text-gray-500">{t('organizer.archive.restoreDescription')}</p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input
            ref={fileRef}
            type="file"
            name="file"
            accept=".json,.zip"
            aria-label={t('organizer.archive.archiveFile')}
            className="block w-full text-sm text-gray-700"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-900 disabled:opacity-50"
          >
            {t('organizer.archive.preview')}
          </button>
        </div>

        {preview && (
          <div className="mt-5 rounded-md border border-gray-100 bg-gray-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-950">{preview.source.eventName}</p>
                <p className="text-xs text-gray-500">
                  {preview.scope === 'tournament'
                    ? preview.source.tournamentName
                    : t('organizer.archive.scopes.event')}
                </p>
              </div>
              <span className="rounded-full bg-white px-2 py-1 text-xs font-medium text-gray-700">
                {t(`organizer.archive.includes.${preview.include}`)}
              </span>
            </div>
            <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
              {Object.entries(preview.counts)
                .filter(([, value]) => value > 0)
                .map(([key, value]) => (
                  <div key={key} className="rounded-md bg-white p-2">
                    <dt className="text-xs text-gray-500">{key}</dt>
                    <dd className="font-semibold text-gray-950">{value}</dd>
                  </div>
                ))}
            </dl>
            {preview.warnings.length > 0 && (
              <ul className="mt-4 list-disc pl-5 text-sm text-red-700">
                {preview.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <input
                value={confirmation}
                onChange={(changeEvent) => setConfirmation(changeEvent.target.value)}
                aria-label={t('organizer.archive.confirmation')}
                placeholder={RESTORE_CONFIRMATION}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={restoreArchive}
                disabled={busy || !preview.canRestore || confirmation !== RESTORE_CONFIRMATION}
                className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {t('organizer.archive.restoreCopy')}
              </button>
            </div>
          </div>
        )}
      </form>
    </main>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="block">
      <span className="mb-1 block text-xs font-medium uppercase text-gray-500">{label}</span>
      {children}
    </div>
  );
}

function Alert({ tone, children }: { tone: 'error' | 'success'; children: string }) {
  return (
    <div
      className={`mb-4 rounded-md border px-4 py-3 text-sm ${
        tone === 'error'
          ? 'border-red-200 bg-red-50 text-red-700'
          : 'border-green-200 bg-green-50 text-green-700'
      }`}
    >
      {children}
    </div>
  );
}
