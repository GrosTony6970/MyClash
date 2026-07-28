'use client';

import {
  Button,
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableRow,
  Modal,
  StatusHelp,
  TournamentColorDot,
  statusPillClass,
  tournamentStatusSemantic,
} from '@myclash/ui';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from '../../../../../../src/i18n/I18nProvider';
import { computeWizardStep } from './new/_wizard/compute-wizard-step';
import { useEventStatus } from '../_hooks/useEventStatus';
import { RequestDeletionModal } from '../../_components/RequestDeletionModal';
import { formatCountOfMax } from '../format-count-of-max';
import { pillClassFor } from './_lib/pill-class-for';
import { AttachToLeaguePanel } from './_components/AttachToLeaguePanel';
import { getPublicApiUrl } from '@/lib/api-url';

interface Tournament {
  id: string;
  slug: string;
  name: string;
  weapon: string | null;
  status: string;
  color: string | null;
  ruleset_code: string | null;
  ruleset_version: string | null;
  scoring_config_json: Record<string, unknown> | null;
  ruleset_config: Record<string, unknown> | null;
  lock_config_json: Record<string, unknown> | null;
  maxParticipants: number | null;
  maxWaitlist: number | null;
  /** Count of registered + checked_in registrations — drives the table's Registered column. */
  registered: number;
  /** Venue each phase runs at (pools / bracket can differ) — drives the Venue(s) column. */
  phaseVenues: {
    pool: { id: string; name: string } | null;
    bracket: { id: string; name: string } | null;
  };
}

function parsePhaseVenue(value: unknown): { id: string; name: string } | null {
  if (value == null || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v['id'] !== 'string' || typeof v['name'] !== 'string') return null;
  return { id: v['id'], name: v['name'] };
}

function normalizeTournament(row: Record<string, unknown>): Tournament {
  return {
    id: String(row['id']),
    slug: String(row['slug'] ?? ''),
    name: String(row['name'] ?? ''),
    weapon: typeof row['weapon'] === 'string' ? row['weapon'] : null,
    status: String(row['status'] ?? 'draft'),
    color: typeof row['color'] === 'string' ? row['color'] : null,
    ruleset_code: typeof row['ruleset_code'] === 'string' ? row['ruleset_code'] : null,
    ruleset_version: typeof row['ruleset_version'] === 'string' ? row['ruleset_version'] : null,
    scoring_config_json:
      row['scoring_config_json'] != null &&
      typeof row['scoring_config_json'] === 'object' &&
      !Array.isArray(row['scoring_config_json'])
        ? (row['scoring_config_json'] as Record<string, unknown>)
        : null,
    ruleset_config:
      row['ruleset_config'] != null &&
      typeof row['ruleset_config'] === 'object' &&
      !Array.isArray(row['ruleset_config'])
        ? (row['ruleset_config'] as Record<string, unknown>)
        : null,
    lock_config_json:
      row['lock_config_json'] != null &&
      typeof row['lock_config_json'] === 'object' &&
      !Array.isArray(row['lock_config_json'])
        ? (row['lock_config_json'] as Record<string, unknown>)
        : null,
    maxParticipants: typeof row['max_participants'] === 'number' ? row['max_participants'] : null,
    maxWaitlist: typeof row['max_waitlist'] === 'number' ? row['max_waitlist'] : null,
    registered: typeof row['registered'] === 'number' ? row['registered'] : 0,
    phaseVenues: {
      pool: parsePhaseVenue((row['phaseVenues'] as Record<string, unknown> | undefined)?.['pool']),
      bracket: parsePhaseVenue(
        (row['phaseVenues'] as Record<string, unknown> | undefined)?.['bracket'],
      ),
    },
  };
}

export default function EventTournamentsPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const apiUrl = getPublicApiUrl();
  const { t } = useI18n();
  const { isArchived, isReadOnly } = useEventStatus(eventId);

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [eventName, setEventName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Tournament | null>(null);
  const [deletionRequestTarget, setDeletionRequestTarget] = useState<Tournament | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchTournaments = async (signal: AbortSignal) => {
    const tourRes = await fetch(`${apiUrl}/api/v1/events/${eventId}/tournaments`, {
      credentials: 'include',
      signal,
    });
    if (!tourRes.ok) throw new Error(t('organizer.tournaments.loadError'));
    const rows = (await tourRes.json()) as Array<Record<string, unknown>>;
    return rows.map(normalizeTournament);
  };

  const fetchEventName = async (signal: AbortSignal) => {
    const res = await fetch(`${apiUrl}/api/v1/events/${eventId}`, {
      credentials: 'include',
      signal,
    });
    if (!res.ok) return '';
    const data = (await res.json()) as { name?: string };
    return data.name ?? '';
  };

  const load = () => {
    const controller = new AbortController();
    setLoading(true);
    fetchTournaments(controller.signal)
      .then((rows) => {
        setTournaments(rows);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : t('organizer.tournaments.loadError'));
      })
      .finally(() => setLoading(false));
    return controller;
  };

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([fetchTournaments(controller.signal), fetchEventName(controller.signal)])
      .then(([rows, name]) => {
        setTournaments(rows);
        setEventName(name);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : t('organizer.tournaments.loadError'));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, apiUrl]);

  async function changeStatus(tournament: Tournament, nextStatus: string) {
    if (nextStatus === tournament.status) return;
    setBusyId(tournament.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/tournaments/${tournament.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('organizer.tournaments.saveError'));
      }
      setNotice(t('organizer.tournaments.statusUpdated'));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizer.tournaments.saveError'));
    } finally {
      setBusyId(null);
    }
  }

  async function archiveTournament(tournament: Tournament) {
    setBusyId(tournament.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/tournaments/${tournament.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'archived' }),
      });
      if (!res.ok) throw new Error(t('organizer.tournaments.archiveError'));
      setNotice(t('organizer.tournaments.archived'));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizer.tournaments.archiveError'));
    } finally {
      setBusyId(null);
    }
  }

  async function hardDeleteTournament() {
    if (!confirmDelete) return;
    setBusyId(confirmDelete.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/tournaments/${confirmDelete.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('organizer.tournaments.deleteError'));
      }
      setConfirmDelete(null);
      setNotice(t('organizer.tournaments.deleted'));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('organizer.tournaments.deleteError'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="mx-auto max-w-[110rem] p-6 lg:p-8">
      {(loading || tournaments.length > 0) && (
        <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-muted">
              <Link href={`/org/${slug}`} className="hover:text-accent">
                {slug}
              </Link>
              <span>/</span>
              <Link href={`/org/${slug}/events/${eventId}`} className="hover:text-accent">
                {eventName || t('organizer.shell.nav.eventOverview')}
              </Link>
              <span>/</span>
              <span className="font-medium text-foreground">
                {t('organizer.shell.nav.tournaments')}
              </span>
            </div>
            <h1 className="mt-2 font-display font-bold text-2xl sm:text-3xl text-foreground">
              {t('organizer.tournaments.title')}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {t('organizer.tournaments.description', { event: eventName || eventId })}
            </p>
          </div>
          {isArchived ? (
            <span
              title={t('organizer.deletionRequest.archivedReadOnly')}
              className="inline-flex w-fit items-center rounded-md bg-border px-5 py-2.5 text-sm font-semibold text-muted cursor-not-allowed"
            >
              {t('organizer.tournaments.create')}
            </span>
          ) : (
            <Link
              href={`/org/${slug}/events/${eventId}/tournaments/new`}
              className="inline-flex w-fit items-center rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground shadow-sm transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              {t('organizer.tournaments.create')}
            </Link>
          )}
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-6 rounded-md border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
          {notice}
        </div>
      )}

      <section
        className={
          loading ? 'overflow-hidden rounded-lg border border-border bg-surface shadow-sm' : ''
        }
      >
        {loading && (
          <div className="flex items-center gap-2 px-5 py-8 text-sm text-muted">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent" />
            {t('organizer.tournaments.loading')}
          </div>
        )}

        {!loading && tournaments.length === 0 && (
          <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
            <h2 className="mb-3 font-display font-semibold text-lg sm:text-xl text-foreground">
              {t('organizer.tournaments.emptyTitle')}
            </h2>
            <p className="mb-6 max-w-md text-sm text-muted">
              {t('organizer.tournaments.emptyDescription')}
            </p>
            <Link
              href={`/org/${slug}/events/${eventId}/tournaments/new`}
              className="rounded-md bg-accent px-6 py-2.5 text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              {t('organizer.tournaments.create')}
            </Link>
          </div>
        )}

        {!loading && tournaments.length > 0 && (
          <DataTable className="min-w-full">
            <DataTableHead>
              <DataTableCell as="th">{t('organizer.tournaments.table.tournament')}</DataTableCell>
              <DataTableCell as="th">{t('organizer.tournaments.table.weapon')}</DataTableCell>
              <DataTableCell as="th">{t('organizer.tournaments.table.venues')}</DataTableCell>
              <DataTableCell as="th" className="text-center">
                {t('organizer.tournaments.table.registered')}
              </DataTableCell>
              <DataTableCell as="th">{t('organizer.tournaments.table.status')}</DataTableCell>
              <DataTableCell as="th">{t('organizer.tournaments.table.actions')}</DataTableCell>
            </DataTableHead>
            <tbody>
              {tournaments.map((tournament) => (
                <DataTableRow key={tournament.id}>
                  <DataTableCell>
                    <span
                      className={[
                        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold',
                        pillClassFor(tournament.color),
                      ].join(' ')}
                    >
                      <TournamentColorDot color={tournament.color} />
                      {tournament.name}
                    </span>
                  </DataTableCell>
                  <DataTableCell className="text-foreground-secondary">
                    {tournament.weapon ?? '-'}
                  </DataTableCell>
                  <DataTableCell className="text-foreground-secondary">
                    {tournament.phaseVenues.pool || tournament.phaseVenues.bracket ? (
                      <div className="flex flex-col gap-0.5 text-xs">
                        {tournament.phaseVenues.pool && (
                          <span>
                            {t('organizer.tournaments.venuesEditor.poolsAt', {
                              venue: tournament.phaseVenues.pool.name,
                            })}
                          </span>
                        )}
                        {tournament.phaseVenues.bracket && (
                          <span>
                            {t('organizer.tournaments.venuesEditor.bracketAt', {
                              venue: tournament.phaseVenues.bracket.name,
                            })}
                          </span>
                        )}
                      </div>
                    ) : (
                      '-'
                    )}
                  </DataTableCell>
                  <DataTableCell className="text-center font-mono text-sm tabular-nums text-foreground-secondary">
                    {formatCountOfMax(tournament.registered, tournament.maxParticipants)}
                  </DataTableCell>
                  <DataTableCell>
                    <span className="inline-flex items-center">
                      <select
                        value={tournament.status}
                        onChange={(event) => void changeStatus(tournament, event.target.value)}
                        disabled={isReadOnly || busyId === tournament.id}
                        aria-label={t('organizer.tournaments.status')}
                        className={[
                          statusPillClass(tournamentStatusSemantic(tournament.status), 'light', {
                            size: 'sm',
                          }),
                          'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60',
                        ].join(' ')}
                      >
                        {['draft', 'published', 'running', 'completed', 'archived'].map(
                          (status) => (
                            <option key={status} value={status}>
                              {status}
                            </option>
                          ),
                        )}
                      </select>
                      <StatusHelp domain="tournament" status={tournament.status} t={t} />
                    </span>
                  </DataTableCell>
                  <DataTableCell>
                    <div className="flex flex-wrap gap-2">
                      <Link
                        href={`/org/${slug}/events/${eventId}/tournaments/${tournament.id}/settings#basics`}
                        className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground-secondary hover:bg-background"
                      >
                        {t('organizer.tournaments.edit')}
                      </Link>
                      {(() => {
                        if (tournament.status !== 'draft') return null;
                        const wizardStep = computeWizardStep({
                          id: tournament.id,
                          name: tournament.name,
                          slug: tournament.slug,
                          ruleset_code: tournament.ruleset_code,
                          ruleset_version: tournament.ruleset_version,
                          scoring_config_json: tournament.scoring_config_json,
                          ruleset_config: tournament.ruleset_config,
                          lock_config_json: tournament.lock_config_json,
                          status: tournament.status,
                        });
                        if (wizardStep === null) return null;
                        return (
                          <>
                            <Link
                              href={`/org/${slug}/events/${eventId}/tournaments/new?id=${tournament.id}&step=${wizardStep}`}
                              className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground hover:bg-accent-hover"
                            >
                              {t('organizer.tournaments.list.resumeSetup')}
                            </Link>
                            <span className="text-xs text-muted">
                              {t('admin.orgTournaments.draftStep', { step: wizardStep })}
                            </span>
                          </>
                        );
                      })()}
                      <Button
                        type="button"
                        size="sm"
                        variant="cancel"
                        disabled={
                          busyId === tournament.id || tournament.status === 'archived' || isReadOnly
                        }
                        onClick={() => void archiveTournament(tournament)}
                      >
                        {t('organizer.tournaments.archive')}
                      </Button>
                      {isArchived ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="danger"
                          onClick={() => setDeletionRequestTarget(tournament)}
                        >
                          {t('organizer.deletionRequest.requestDeletion')}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="danger"
                          disabled={busyId === tournament.id}
                          onClick={() => setConfirmDelete(tournament)}
                        >
                          {t('organizer.tournaments.hardDelete')}
                        </Button>
                      )}
                    </div>
                  </DataTableCell>
                </DataTableRow>
              ))}
            </tbody>
          </DataTable>
        )}
      </section>

      {!isReadOnly && !loading && tournaments.length > 0 && (
        <div className="mt-6">
          <AttachToLeaguePanel eventId={eventId} />
        </div>
      )}

      {confirmDelete && (
        <Modal
          open
          onClose={() => setConfirmDelete(null)}
          busy={busyId === confirmDelete.id}
          size="md"
          title={t('organizer.tournaments.deleteTitle')}
          footer={
            <>
              <Button type="button" variant="cancel" onClick={() => setConfirmDelete(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                variant="danger"
                loading={busyId === confirmDelete.id}
                onClick={() => void hardDeleteTournament()}
              >
                {t('organizer.tournaments.confirmHardDelete')}
              </Button>
            </>
          }
        >
          <p className="mt-2 text-sm text-foreground-secondary">
            {t('organizer.tournaments.deleteWarning', { name: confirmDelete.name })}
          </p>
        </Modal>
      )}

      {deletionRequestTarget && (
        <RequestDeletionModal
          targetType="tournament"
          targetId={deletionRequestTarget.id}
          targetLabel={deletionRequestTarget.name}
          onSuccess={() => setDeletionRequestTarget(null)}
          onClose={() => setDeletionRequestTarget(null)}
        />
      )}
    </main>
  );
}
