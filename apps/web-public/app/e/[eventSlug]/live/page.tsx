'use client';

import { DEFAULT_EVENT_TIMEZONE, formatInZone, localeToBcp47, type AppLocale } from '@myclash/time';
import { FreshnessChip, nameOrUnknown } from '@myclash/ui';
import { boutPageHref } from '@/lib/bout-page';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { BackLink } from '@/components/BackLink';
import { useI18n } from '@myclash/next-i18n/client';
import { LiveMatchCard } from '../home/_components/LiveMatchCard';
import { useLiveBoard, type LiveMatch } from './use-live-board';

function formatTime(hhmm: string): string {
  return hhmm.slice(0, 5);
}

/** A time on the EVENT's clock: a spectator's phone may be on another. */
function scheduledTime(iso: string | null, tz: string, locale: AppLocale): string {
  return formatInZone(iso, tz, { hour: '2-digit', minute: '2-digit' }, localeToBcp47(locale));
}

/**
 * A halted bout still holds its piste, so it keeps its card — but a stopped
 * clock must not pulse like a live exchange.
 */
function LiveBadge({ paused = false }: { paused?: boolean }) {
  const { t } = useI18n();
  if (paused) {
    return (
      <span className="inline-flex items-center bg-border text-muted text-xs font-bold px-2 py-0.5 rounded-full">
        {t('publicApp.live.paused')}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 bg-danger text-danger-foreground text-xs font-bold px-2 py-0.5 rounded-full">
      <span className="w-1.5 h-1.5 rounded-full bg-danger-foreground animate-pulse" />
      {t('publicApp.live.badge')}
    </span>
  );
}

/** The next bout of a piste: not in play yet, so it has a time and no score. */
function NextBoutCard({ match, label, tz }: { match: LiveMatch; label: string; tz: string }) {
  const { t, locale } = useI18n();
  return (
    <div className="rounded-xl p-3 border bg-surface border-border">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted font-medium">{label}</span>
        {match.scheduledAt && (
          <span className="text-xs text-muted">{scheduledTime(match.scheduledAt, tz, locale)}</span>
        )}
      </div>
      <p className="text-sm font-bold text-foreground">{match.matchNumberLabel}</p>
      <p className="text-sm text-foreground-secondary mt-0.5">
        {match.redFighterName ?? '?'}{' '}
        <span className="text-muted text-xs">{t('scoring.liveMatch.versus')}</span>{' '}
        {match.blueFighterName ?? '?'}
      </p>
      {match.tournamentName && <p className="text-xs text-muted mt-1">{match.tournamentName}</p>}
    </div>
  );
}

export default function LivePage() {
  const { t, locale } = useI18n();
  const params = useParams<{ eventSlug: string }>();
  const searchParams = useSearchParams();
  const { eventSlug } = params;
  const focusLiceId = searchParams.get('lice');

  const { state, loading, freshness } = useLiveBoard(eventSlug);
  // Always shown: on a phone, "no chip" and "a chip I did not notice" look the same.
  const howFresh = <FreshnessChip freshness={freshness} t={t} className="self-center" />;

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <span className="w-8 h-8 border-2 border-muted border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  if (!state) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 text-center">
        <div>
          <p className="text-4xl mb-3">📅</p>
          <h1 className="font-display font-bold text-2xl sm:text-3xl text-foreground mb-2">
            {t('publicApp.live.scheduleUnavailableTitle')}
          </h1>
          <p className="text-muted text-sm">{t('publicApp.live.scheduleUnavailableBody')}</p>
        </div>
      </main>
    );
  }

  const tz = state.timezone ?? DEFAULT_EVENT_TIMEZONE;

  // ── Drill-down mode ────────────────────────────────────────────────────────
  if (focusLiceId) {
    const ls = state.lices.find((l) => l.lice.id === focusLiceId);
    if (!ls) {
      return (
        <main className="flex min-h-screen items-center justify-center px-4 text-center">
          <div>
            <p className="text-muted text-sm">{t('publicApp.live.liceNotFound')}</p>
            <BackLink
              href={`/e/${eventSlug}/live`}
              label={t('publicApp.live.backToOverview')}
              className="mt-4"
            />
          </div>
        </main>
      );
    }

    return (
      <main className="flex flex-col min-h-screen px-4 py-6 max-w-md mx-auto gap-4">
        <BackLink href={`/e/${eventSlug}/live`} label={t('publicApp.live.allPistes')} />

        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-1">
            {t('publicApp.live.piste')}
          </p>
          <h1 className="font-display font-bold text-2xl sm:text-3xl text-foreground">
            {ls.lice.name}
          </h1>
        </div>

        {state.currentBlock && (
          <p className="text-sm text-muted">
            {state.currentBlock.label} · {formatTime(state.currentBlock.startTime)}–
            {formatTime(state.currentBlock.endTime)}
          </p>
        )}

        {ls.runningMatch ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
              {t('publicApp.live.nowFighting')}
            </p>
            {/* The piste is the page's title: the card does not name it again. */}
            <LiveMatchCard
              match={{ ...ls.runningMatch, liceName: null }}
              href={boutPageHref(
                eventSlug,
                ls.runningMatch.id,
                `/e/${eventSlug}/live?lice=${ls.lice.id}`,
              )}
              pausedLabel={ls.runningMatch.status === 'paused' ? t('publicApp.live.paused') : null}
              t={t}
            />
          </div>
        ) : (
          <div className="rounded-xl p-4 bg-surface border border-border text-center">
            <p className="text-muted text-sm">{t('publicApp.live.noActiveMatch')}</p>
          </div>
        )}

        {ls.nextMatch && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
              {t('publicApp.live.upNext')}
            </p>
            <NextBoutCard match={ls.nextMatch} label={t('publicApp.live.next')} tz={tz} />
          </div>
        )}

        {howFresh}
      </main>
    );
  }

  // ── Overview mode ──────────────────────────────────────────────────────────
  const anyRunning = state.lices.some((l) => l.runningMatch !== null);

  return (
    <main className="flex flex-col min-h-screen px-4 py-6 max-w-2xl mx-auto gap-6">
      <BackLink href={`/e/${eventSlug}/home`} label={t('publicApp.eventHome.backToHome')} />
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-1">
            {t('publicApp.live.liveSchedule')}
          </p>
          {state.currentBlock ? (
            <>
              <h1 className="font-display font-bold text-2xl sm:text-3xl text-foreground">
                {state.currentBlock.label}
              </h1>
              <p className="text-sm text-muted mt-0.5">
                {formatTime(state.currentBlock.startTime)}–{formatTime(state.currentBlock.endTime)}
              </p>
            </>
          ) : state.nextBlock ? (
            <>
              <h1 className="font-display font-bold text-2xl sm:text-3xl text-muted">
                {t('publicApp.live.betweenSessions')}
              </h1>
              <p className="text-sm text-muted mt-0.5">
                {t('publicApp.live.nextBlock', {
                  label: state.nextBlock.label,
                  time: formatTime(state.nextBlock.startTime),
                })}
              </p>
            </>
          ) : (
            <h1 className="font-display font-bold text-2xl sm:text-3xl text-muted">
              {t('publicApp.live.noActiveSession')}
            </h1>
          )}
        </div>
        {anyRunning && <LiveBadge />}
      </div>

      {/* Lice grid */}
      {state.lices.length === 0 ? (
        <p className="text-muted text-sm">{t('publicApp.live.noPistesConfigured')}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {state.lices.map((ls) => (
            <Link
              key={ls.lice.id}
              href={`/e/${eventSlug}/live?lice=${ls.lice.id}`}
              className="rounded-xl bg-surface border border-border p-4 hover:border-muted transition-colors block"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-muted uppercase tracking-wide">
                  {ls.lice.name}
                </span>
                {ls.runningMatch && <LiveBadge paused={ls.runningMatch.status === 'paused'} />}
              </div>

              {ls.runningMatch ? (
                <div>
                  <p className="text-sm font-bold text-foreground">
                    {ls.runningMatch.matchNumberLabel}
                  </p>
                  <p className="text-sm text-foreground-secondary mt-0.5">
                    {nameOrUnknown(ls.runningMatch.redFighterName, 'fighter', t)}{' '}
                    <span className="text-muted text-xs">{t('scoring.liveMatch.versus')}</span>{' '}
                    {nameOrUnknown(ls.runningMatch.blueFighterName, 'fighter', t)}
                  </p>
                  {/* Red's score first, as the names above. The whole tile is a
                      link to its piste, so the shared card (a link) cannot sit here. */}
                  <p
                    data-testid="live-score"
                    className="mt-1 text-xl font-black tabular-nums text-foreground"
                  >
                    {ls.runningMatch.redScore}
                    <span className="mx-1.5 text-muted">–</span>
                    {ls.runningMatch.blueScore}
                  </p>
                </div>
              ) : ls.nextMatch ? (
                <div>
                  <p className="text-xs text-muted mb-1">{t('publicApp.live.nextUp')}</p>
                  <p className="text-sm font-medium text-foreground-secondary">
                    {ls.nextMatch.matchNumberLabel}
                  </p>
                  <p className="text-sm text-muted">
                    {ls.nextMatch.redFighterName ?? '?'}{' '}
                    <span className="text-muted text-xs">{t('scoring.liveMatch.versus')}</span>{' '}
                    {ls.nextMatch.blueFighterName ?? '?'}
                  </p>
                  {ls.nextMatch.scheduledAt && (
                    <p className="text-xs text-muted mt-1">
                      {scheduledTime(ls.nextMatch.scheduledAt, tz, locale)}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-muted text-sm">–</p>
              )}
            </Link>
          ))}
        </div>
      )}

      {howFresh}
    </main>
  );
}
