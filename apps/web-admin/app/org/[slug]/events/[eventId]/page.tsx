'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  TournamentColorDot,
  formatCountryName,
  statusPillTone,
  tournamentStatusSemantic,
} from '@myclash/ui';
import { useI18n } from '../../../../../src/i18n/I18nProvider';
import { TournamentQueryPanel } from './TournamentQueryPanel';
import { useEventStatus } from './_hooks/useEventStatus';
import { RequestDeletionModal } from '../_components/RequestDeletionModal';
import { EventLogoCard } from './_components/EventLogoCard';
import { formatCountOfMax } from './format-count-of-max';
import { eventVisibility } from './event-visibility';

interface Tournament {
  id: string;
  slug: string;
  name: string;
  status: string;
  color?: string | null;
  rulesetCode?: string | null;
  poolCount?: number;
  bracketSize?: number | null;
  eliminationType?: string | null;
}

interface EventInfo {
  id: string;
  name: string;
  slug: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  city: string | null;
  country: string | null;
  logoUrl: string | null;
}

interface DashboardStats {
  event: EventInfo;
  totals: {
    tournaments: number;
    registeredFighters: number;
    waitlistedFighters: number;
    maxParticipants: number | null;
    maxWaitlist: number | null;
    uniqueFighters: number;
    uniqueReferees: number;
    clubsRepresented: number;
  };
  tournaments: Array<
    Tournament & {
      fighterCount: number;
      waitlistedCount: number;
      maxParticipants: number | null;
      maxWaitlist: number | null;
      assignedRefereeCount: number;
    }
  >;
}

interface AIUsage {
  totalSpendEur: number;
  cap: number | null;
  remainingEur: number | null;
  callCount: number;
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value: string | null): string {
  const date = parseDate(value);
  return date ? date.toLocaleDateString('fr-FR') : '-';
}

function durationDays(start: string | null, end: string | null): number {
  const startDate = parseDate(start);
  const endDate = parseDate(end);
  if (!startDate || !endDate) return 0;
  const diff = Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000);
  return Math.max(1, diff + 1);
}

function daysUntil(start: string | null, now: number): number | null {
  const startDate = parseDate(start);
  if (!startDate) return null;
  return Math.ceil((startDate.getTime() - now) / 86_400_000);
}

// Common IANA timezones for the event settings picker. The current stored
// value is always merged in, so a zone outside this list still displays.
const COMMON_TIMEZONES = [
  'Europe/Paris',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Berlin',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Europe/Brussels',
  'Europe/Zurich',
  'Europe/Stockholm',
  'Europe/Warsaw',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Australia/Sydney',
  'UTC',
];

export default function EventDetailPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { slug, eventId } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const { t, locale } = useI18n();
  const { isArchived, isReadOnly } = useEventStatus(eventId);
  const [showDeletionModal, setShowDeletionModal] = useState(false);

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [tournamentBusy, setTournamentBusy] = useState<string | null>(null);
  const [tournamentError, setTournamentError] = useState<string | null>(null);
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiUsage, setAiUsage] = useState<AIUsage | null>(null);
  const [spendCap, setSpendCap] = useState<string>('');
  const [savingCap, setSavingCap] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [timezone, setTimezone] = useState<string>('Europe/Paris');
  const [savingTz, setSavingTz] = useState(false);
  const [now] = useState(() => Date.now());

  const reloadStats = (signal?: AbortSignal) =>
    Promise.all([
      fetch(`${apiUrl}/api/v1/events/${eventId}/dashboard-stats`, {
        credentials: 'include',
        ...(signal ? { signal } : {}),
      }),
      fetch(`${apiUrl}/api/v1/events/${eventId}/tournaments`, {
        credentials: 'include',
        ...(signal ? { signal } : {}),
      }),
    ])
      .then(async ([statsRes, tourRes]) => {
        if (!statsRes.ok) throw new Error(t('organizer.eventHub.dashboard.loadError'));
        setStats((await statsRes.json()) as DashboardStats);
        if (tourRes.ok) setTournaments((await tourRes.json()) as Tournament[]);
        setStatsError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setStatsError(err instanceof Error ? err.message : t('common.error'));
      });

  useEffect(() => {
    const controller = new AbortController();
    void reloadStats(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, apiUrl, t]);

  async function changeTournamentStatus(tournamentId: string, status: string) {
    setTournamentBusy(tournamentId);
    setTournamentError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('organizer.eventHub.dashboard.statusUpdateError'));
      }
      await reloadStats();
    } catch (err) {
      setTournamentError(
        err instanceof Error ? err.message : t('organizer.eventHub.dashboard.statusUpdateError'),
      );
    } finally {
      setTournamentBusy(null);
    }
  }

  async function toggleTournamentVisibility(tournament: Tournament) {
    // Cycle draft ↔ published. Other statuses leave the toggle disabled.
    const mode = tournament.status === 'draft' ? 'publish' : 'unpublish';
    setTournamentBusy(tournament.id);
    setTournamentError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/tournaments/${tournament.id}/${mode}`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('organizer.eventHub.dashboard.visibilityError'));
      }
      await reloadStats();
    } catch (err) {
      setTournamentError(
        err instanceof Error ? err.message : t('organizer.eventHub.dashboard.visibilityError'),
      );
    } finally {
      setTournamentBusy(null);
    }
  }

  async function toggleEventVisibility() {
    const status = stats?.event?.status;
    if (!status) return;
    const { mode } = eventVisibility(status);
    if (!mode) return; // only draft ↔ published is toggleable
    setVisibilityBusy(true);
    setStatsError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/${mode}`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t('organizer.events.visibilityError'));
      }
      await reloadStats();
    } catch (err) {
      setStatsError(err instanceof Error ? err.message : t('organizer.events.visibilityError'));
    } finally {
      setVisibilityBusy(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const orgRes = await fetch(`${apiUrl}/api/v1/organizations/slug/${slug}`, {
          credentials: 'include',
          signal: controller.signal,
        });
        if (!orgRes.ok) return;
        const orgData = (await orgRes.json()) as { id: string };

        const aiRes = await fetch(`${apiUrl}/api/v1/organizations/${orgData.id}/ai-settings`, {
          credentials: 'include',
          signal: controller.signal,
        });
        if (aiRes.ok) {
          const aiData = (await aiRes.json()) as {
            provider: string;
            hasKey: boolean;
            updatedAt: string;
          } | null;
          if (aiData !== null) setAiEnabled(true);
        }

        const usageRes = await fetch(`${apiUrl}/api/v1/events/${eventId}/ai-usage`, {
          credentials: 'include',
          signal: controller.signal,
        });
        if (usageRes.ok) {
          const usageData = (await usageRes.json()) as AIUsage;
          setAiUsage(usageData);
          setSpendCap(String(usageData.cap ?? ''));
        }
      } catch {
        // AI status is optional on this dashboard.
      }
    })();
    return () => controller.abort();
  }, [slug, eventId, apiUrl]);

  async function handleSaveCap() {
    if (!eventId) return;
    setSavingCap(true);
    try {
      await fetch(`${apiUrl}/api/v1/events/${eventId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          aiSpendCapEur: (() => {
            const parsed = parseFloat(spendCap);
            return spendCap === '' || isNaN(parsed) ? null : parsed;
          })(),
        }),
      });
      const response = await fetch(`${apiUrl}/api/v1/events/${eventId}/ai-usage`, {
        credentials: 'include',
      });
      if (response.ok) setAiUsage((await response.json()) as AIUsage);
    } catch {
      // Keep the previous budget value visible.
    } finally {
      setSavingCap(false);
    }
  }

  // Load the event's current timezone for the settings picker.
  useEffect(() => {
    if (!eventId) return;
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/events/${eventId}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const ev = (await res.json()) as { timezone?: string | null };
        if (ev.timezone) setTimezone(ev.timezone);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [apiUrl, eventId]);

  async function handleSaveTimezone(next: string) {
    setTimezone(next);
    setSavingTz(true);
    try {
      await fetch(`${apiUrl}/api/v1/events/${eventId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ timezone: next }),
      });
    } finally {
      setSavingTz(false);
    }
  }

  const event = stats?.event;
  const vis = event ? eventVisibility(event.status) : null;
  const startDelta = useMemo(
    () => (now > 0 ? daysUntil(event?.startDate ?? null, now) : null),
    [event, now],
  );
  const liveState =
    event?.status === 'completed'
      ? t('organizer.eventHub.dashboard.completed')
      : event?.status === 'running'
        ? t('organizer.eventHub.dashboard.live')
        : startDelta === null
          ? '-'
          : startDelta > 0
            ? t('organizer.eventHub.dashboard.daysUntil', { count: startDelta })
            : startDelta === 0
              ? t('organizer.eventHub.dashboard.startsToday')
              : t('organizer.eventHub.dashboard.startedAgo', { count: Math.abs(startDelta) });

  return (
    <main className="mx-auto max-w-7xl p-6 lg:p-8">
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted">
            <Link href={`/org/${slug}`} className="hover:text-accent">
              {t('organizer.eventHub.backToOrg')}
            </Link>
            <span>/</span>
            {event ? (
              <span className="font-medium text-foreground">
                {event.name?.trim() ? event.name : t('organizer.eventHub.untitledEvent')}
              </span>
            ) : (
              <span
                aria-hidden="true"
                className="inline-block h-4 w-32 animate-pulse rounded bg-border"
              />
            )}
          </div>
          {event ? (
            <h1 className="mt-3 font-display font-bold text-2xl sm:text-3xl text-foreground">
              {event.name?.trim() ? event.name : t('organizer.eventHub.untitledEvent')}
            </h1>
          ) : (
            <span
              aria-label={t('organizer.eventHub.loadingEvent')}
              className="mt-3 inline-block h-8 w-64 animate-pulse rounded-md bg-border"
            />
          )}
          {event && (
            <p className="mt-1 text-sm text-muted">
              {(() => {
                const place = [event.city, formatCountryName(event.country, locale)]
                  .filter(Boolean)
                  .join(', ');
                return place ? `${place} - ` : '';
              })()}
              {formatDate(event.startDate)}
              {event.startDate !== event.endDate ? ` - ${formatDate(event.endDate)}` : ''}
            </p>
          )}
        </div>
        {event?.status && (
          <span
            className={`w-fit rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${
              statusPillTone(tournamentStatusSemantic(event.status), 'light').className
            }`}
          >
            {event.status}
          </span>
        )}
      </div>

      {statsError && (
        <div className="mb-6 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm font-medium text-danger">
          {statsError}
        </div>
      )}

      {event && vis && (
        <div className="mb-8 rounded-lg border border-border bg-surface p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                {t('organizer.events.visibilityCardTitle')}
              </p>
              <p className="mt-1 text-sm text-muted">
                {vis.isPublic
                  ? t('organizer.events.visibilityPublicHint')
                  : t('organizer.events.visibilityHiddenHint')}
              </p>
              {!vis.canToggle && (
                <p className="mt-1 text-xs text-warning">
                  {t('organizer.events.visibilityLocked', { status: event.status })}
                </p>
              )}
            </div>
            <div className="flex flex-shrink-0 items-center gap-3">
              <span className="text-sm font-semibold text-foreground-secondary">
                {vis.isPublic
                  ? t('organizer.events.visibilityPublic')
                  : t('organizer.events.visibilityHidden')}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={vis.isPublic}
                aria-label={
                  vis.isPublic ? t('organizer.events.setDraft') : t('organizer.events.setPublic')
                }
                disabled={!vis.canToggle || isReadOnly || visibilityBusy}
                onClick={() => void toggleEventVisibility()}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                  vis.isPublic ? 'bg-success' : 'bg-border'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`inline-block h-5 w-5 transform rounded-full bg-surface shadow transition-transform ${
                    vis.isPublic ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="mb-8">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
              {t('organizer.eventHub.dashboard.title')}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {t('organizer.eventHub.dashboard.description')}
            </p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <EventLogoCard
            apiUrl={apiUrl}
            eventId={eventId}
            label={t('organizer.eventHub.dashboard.logo')}
            logoUrl={event?.logoUrl ?? null}
            name={event?.name ?? ''}
            emptyLabel={t('organizer.events.logoEmpty')}
            uploadHint={t('organizer.events.uploadLogo')}
            replaceHint={t('organizer.events.logoReplace')}
            uploadingLabel={t('organizer.events.logoUploading')}
            tooLargeLabel={t('organizer.events.logoTooLarge')}
            wrongTypeLabel={t('organizer.events.logoWrongType')}
            failedLabel={t('organizer.events.logoUploadFailed')}
            onUploaded={() => reloadStats()}
            disabled={isReadOnly}
          />
          <MetricCard
            label={t('organizer.eventHub.dashboard.startDate')}
            value={formatDate(event?.startDate ?? null)}
            detail={t('organizer.eventHub.dashboard.duration', {
              count: durationDays(event?.startDate ?? null, event?.endDate ?? null),
            })}
          />
          <MetricCard
            label={t('organizer.eventHub.dashboard.endDate')}
            value={formatDate(event?.endDate ?? null)}
            detail={liveState}
          />
          <MetricCard
            label={t('organizer.eventHub.dashboard.tournaments')}
            value={String(stats?.totals.tournaments ?? 0)}
          />
          <MetricCard
            label={t('organizer.eventHub.dashboard.participants')}
            value={formatCountOfMax(
              stats?.totals.registeredFighters ?? 0,
              stats?.totals.maxParticipants ?? null,
            )}
          />
          <MetricCard
            label={t('organizer.eventHub.dashboard.uniqueFighters')}
            value={String(stats?.totals.uniqueFighters ?? 0)}
          />
          <MetricCard
            label={t('organizer.eventHub.dashboard.waitlist')}
            value={formatCountOfMax(
              stats?.totals.waitlistedFighters ?? 0,
              stats?.totals.maxWaitlist ?? null,
            )}
          />
          <MetricCard
            label={t('organizer.eventHub.dashboard.clubs')}
            value={String(stats?.totals.clubsRepresented ?? 0)}
          />
          <MetricCard
            label={t('organizer.eventHub.dashboard.uniqueReferees')}
            value={String(stats?.totals.uniqueReferees ?? 0)}
          />
          <MetricCard
            label={t('organizer.eventHub.dashboard.countdown')}
            value={liveState}
            detail={t('organizer.eventHub.dashboard.visibility', {
              status: event?.status ?? '-',
            })}
          />
        </div>

        {tournamentError && (
          <div className="mt-3 rounded-md border border-danger/30 bg-danger/10 px-4 py-2 text-sm text-danger">
            {tournamentError}
          </div>
        )}
        <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-surface shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-background text-xs uppercase tracking-[0.14em] text-muted">
              <tr>
                <th className="px-4 py-3">{t('organizer.eventHub.dashboard.tournament')}</th>
                <th className="px-4 py-3">{t('organizer.eventHub.dashboard.registered')}</th>
                <th className="px-4 py-3">{t('organizer.eventHub.dashboard.assignedReferees')}</th>
                <th className="px-4 py-3">{t('organizer.eventHub.dashboard.colPools')}</th>
                <th className="px-4 py-3">{t('organizer.eventHub.dashboard.colBracket')}</th>
                <th className="px-4 py-3">{t('organizer.eventHub.dashboard.colElim')}</th>
                <th className="px-4 py-3">{t('organizer.eventHub.dashboard.colRuleset')}</th>
                <th className="px-4 py-3">{t('organizer.eventHub.dashboard.status')}</th>
                <th className="px-4 py-3">{t('organizer.eventHub.dashboard.visibilityColumn')}</th>
              </tr>
            </thead>
            <tbody>
              {(stats?.tournaments ?? []).length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-muted">
                    {t('organizer.eventHub.dashboard.noTournaments')}
                  </td>
                </tr>
              )}
              {(stats?.tournaments ?? []).map((tournament) => {
                const settingsHref = `/org/${slug}/events/${eventId}/tournaments/${tournament.id}/settings`;
                const cellLinkClass =
                  'block w-full text-foreground-secondary hover:text-accent hover:underline';
                const canToggleVisibility =
                  tournament.status === 'draft' || tournament.status === 'published';
                return (
                  <tr key={tournament.id} className="border-t border-border">
                    <td className="px-4 py-3 font-semibold text-foreground">
                      <Link
                        href={settingsHref}
                        className="inline-flex items-center gap-1.5 hover:text-accent hover:underline"
                      >
                        <TournamentColorDot color={tournament.color} />
                        {tournament.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/org/${slug}/events/${eventId}/persons`}
                        className={cellLinkClass}
                      >
                        {formatCountOfMax(tournament.fighterCount, tournament.maxParticipants)}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/org/${slug}/events/${eventId}/referees`}
                        className={cellLinkClass}
                      >
                        {tournament.assignedRefereeCount}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/org/${slug}/events/${eventId}/pools`} className={cellLinkClass}>
                        {tournament.poolCount ?? 0}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/org/${slug}/events/${eventId}/bracket`}
                        className={cellLinkClass}
                      >
                        {tournament.bracketSize ?? '—'}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {tournament.eliminationType === 'single_elim'
                        ? t('organizer.eventHub.dashboard.elimSingle')
                        : tournament.eliminationType === 'double_elim'
                          ? t('organizer.eventHub.dashboard.elimDouble')
                          : '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted">
                      <Link href={settingsHref} className="hover:text-accent hover:underline">
                        {tournament.rulesetCode ?? '—'}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        aria-label={t('organizer.eventHub.dashboard.status')}
                        value={tournament.status}
                        disabled={tournamentBusy === tournament.id || isReadOnly}
                        onChange={(ev) =>
                          void changeTournamentStatus(tournament.id, ev.target.value)
                        }
                        className="rounded-md border border-border bg-surface px-2 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {(['draft', 'published', 'running', 'completed', 'archived'] as const).map(
                          (status) => (
                            <option key={status} value={status}>
                              {t(`organizer.events.statuses.${status}`) || status}
                            </option>
                          ),
                        )}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        aria-label={
                          tournament.status === 'draft'
                            ? t('organizer.eventHub.dashboard.setPublic')
                            : t('organizer.eventHub.dashboard.setDraft')
                        }
                        title={
                          tournament.status === 'draft'
                            ? t('organizer.eventHub.dashboard.setPublic')
                            : tournament.status === 'published'
                              ? t('organizer.eventHub.dashboard.setDraft')
                              : (t(`organizer.events.statuses.${tournament.status}`) ??
                                tournament.status)
                        }
                        disabled={
                          !canToggleVisibility || tournamentBusy === tournament.id || isReadOnly
                        }
                        onClick={() => void toggleTournamentVisibility(tournament)}
                        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {tournament.status === 'draft' ? (
                          <span aria-hidden="true" className="text-muted">
                            ◌
                          </span>
                        ) : tournament.status === 'published' ? (
                          <span aria-hidden="true" className="text-success">
                            ●
                          </span>
                        ) : (
                          <span aria-hidden="true" className="text-muted">
                            —
                          </span>
                        )}
                        {tournament.status === 'draft'
                          ? t('organizer.eventHub.dashboard.visibilityDraft')
                          : tournament.status === 'published'
                            ? t('organizer.eventHub.dashboard.visibilityPublic')
                            : (t(`organizer.events.statuses.${tournament.status}`) ??
                              tournament.status)}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {aiEnabled && <TournamentQueryPanel apiUrl={apiUrl} tournaments={tournaments} />}

      {aiEnabled && (
        <section className="mb-8 rounded-lg border border-border bg-surface shadow-sm">
          <button
            type="button"
            onClick={() => setBudgetOpen(!budgetOpen)}
            className="flex w-full items-center justify-between px-5 py-4 text-left text-xs font-semibold uppercase tracking-wider text-muted"
          >
            <span>{t('organizer.eventHub.aiBudget')}</span>
            <span className="text-muted">{budgetOpen ? 'UP' : 'DOWN'}</span>
          </button>

          {budgetOpen && (
            <div className="space-y-4 border-t border-border px-5 py-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className="flex-1" htmlFor="aiSpendCap">
                  <span className="mb-1 block text-xs font-semibold text-muted">
                    {t('organizer.eventHub.spendCap')}
                  </span>
                  <input
                    id="aiSpendCap"
                    type="number"
                    aria-label={t('organizer.eventHub.spendCap')}
                    min="0"
                    step="0.01"
                    value={spendCap}
                    onChange={(e) => setSpendCap(e.target.value)}
                    placeholder={t('organizer.eventHub.noCap')}
                    className="w-full rounded-md border border-border px-3 py-2 text-sm"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void handleSaveCap()}
                  disabled={savingCap || isReadOnly}
                  title={isReadOnly ? t('organizer.deletionRequest.archivedReadOnly') : undefined}
                  className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:opacity-50"
                >
                  {savingCap ? t('organizer.eventHub.saving') : t('organizer.eventHub.save')}
                </button>
              </div>

              {aiUsage && (
                <div>
                  {aiUsage.cap !== null ? (
                    <>
                      <p className="mb-1 text-sm text-foreground-secondary">
                        {t('organizer.eventHub.budgetUsed', {
                          spent: aiUsage.totalSpendEur.toFixed(2),
                          cap: aiUsage.cap.toFixed(2),
                        })}
                      </p>
                      <div className="h-2 overflow-hidden rounded-full bg-border">
                        <div
                          className="h-full rounded-full bg-accent transition-all"
                          style={{
                            width: `${Math.min(100, (aiUsage.totalSpendEur / aiUsage.cap) * 100)}%`,
                          }}
                        />
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-muted">
                      {t('organizer.eventHub.budgetNoCap', {
                        spent: aiUsage.totalSpendEur.toFixed(2),
                        calls: aiUsage.callCount,
                      })}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      <section className="mb-8 rounded-lg border border-border bg-surface p-5 shadow-sm">
        <label className="block" htmlFor="eventTimezone">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">
            {t('organizer.eventHub.timezone')}
          </span>
          <select
            id="eventTimezone"
            value={timezone}
            disabled={savingTz || isReadOnly}
            onChange={(e) => void handleSaveTimezone(e.target.value)}
            className="mt-1 w-full max-w-xs rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50"
          >
            {Array.from(new Set([timezone, ...COMMON_TIMEZONES])).map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
          {t('organizer.eventHub.archiveTitle')}
        </h2>
        <div className="rounded-lg border border-border bg-surface p-4 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-foreground-secondary">
              {t('organizer.archive.description')}
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              {!isArchived && (
                <Link
                  href={`/org/${slug}/events/${eventId}/archive`}
                  className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-semibold text-danger hover:bg-danger/20"
                >
                  {t('organizer.archive.open')}
                </Link>
              )}
              {isArchived && (
                <button
                  type="button"
                  onClick={() => setShowDeletionModal(true)}
                  className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-semibold text-danger hover:bg-danger/20"
                >
                  {t('organizer.deletionRequest.requestDeletion')}
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {showDeletionModal && (
        <RequestDeletionModal
          targetType="event"
          targetId={eventId}
          targetLabel={event?.name ?? eventId}
          onSuccess={() => setShowDeletionModal(false)}
          onClose={() => setShowDeletionModal(false)}
        />
      )}
    </main>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-2 text-2xl font-bold text-foreground">{value}</p>
      {detail ? <p className="mt-1 text-sm text-muted">{detail}</p> : null}
    </div>
  );
}
