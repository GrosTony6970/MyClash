'use client';

/**
 * The Swiss rounds as a spectator sees them: one section per round, with the
 * pairings, the bye, the scores and the piste.
 *
 * Forced rematches and manual adjustments are badged PUBLICLY (decision 16).
 * That is the point, not a detail: a fighter asked to replay an opponent can
 * see that no legal alternative existed, and a fighter whose pairing an
 * organiser changed by hand can see that it was changed — rather than either of
 * them concluding the draw was fixed.
 *
 * Live updates: realtime on `matches` filtered by the Swiss phase, with the
 * polling fallback, the same shape PoolMatchesView uses.
 */

import { useCallback, useEffect, useState } from 'react';
import { sideStyle } from '@myclash/ui';
import { formatInZone, localeToBcp47 } from '@myclash/time';
import { DEFAULT_SCORING_CONFIG, type TournamentSideColor } from '@myclash/types';
import { useRealtimeWithFallback } from '@/lib/supabase-browser';
import { getPublicApiUrl } from '@/lib/api-url';
import { useI18n } from '@myclash/next-i18n/client';

interface SwissMatch {
  id: string;
  matchNumberLabel: string;
  status: string;
  scheduledAt: string | null;
  redRegistrationId: string | null;
  redFighterName: string | null;
  redClubAbbrev: string | null;
  redScore: number | null;
  blueRegistrationId: string | null;
  blueFighterName: string | null;
  blueClubAbbrev: string | null;
  blueScore: number | null;
  winnerRegistrationId: string | null;
  liceName: string | null;
  liceColorHex: string | null;
}

interface SwissWarning {
  code: string;
  registrationIds: string[];
}

interface SwissRound {
  id: string;
  roundNumber: number;
  status: string;
  warnings: SwissWarning[];
  byeRegistrationId: string | null;
  byeFighterName: string | null;
  manuallyAdjusted: boolean;
  matches: SwissMatch[];
}

interface SwissPayload {
  phaseId: string | null;
  roundCount: number;
  roundsCompleted: number;
  finalized: { atRound: number; at: string } | null;
  sideColors: { red: TournamentSideColor; blue: TournamentSideColor };
  rounds: SwissRound[];
}

export function SwissRoundsView({
  tournamentId,
  timezone,
  /** Personal space: mark the viewer's own bouts. */
  highlightRegistrationId,
}: {
  tournamentId: string;
  timezone?: string;
  highlightRegistrationId?: string | null;
}) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<SwissPayload | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${getPublicApiUrl()}/api/v1/tournaments/${tournamentId}/swiss`, {
        cache: 'no-store',
      });
      if (res.ok) setData((await res.json()) as SwissPayload);
    } catch {
      // Keep whatever is on screen — the poll retries.
    }
  }, [tournamentId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch lifecycle: load sets state only after the awaited request resolves
    void load();
  }, [load]);

  // `matches.phase_id` already exists, so the Swiss phase is the natural
  // subscription scope — there is no pool id to key on here.
  useRealtimeWithFallback({
    channelName: `swiss-${tournamentId}`,
    table: 'matches',
    filter: `phase_id=eq.${data?.phaseId ?? ''}`,
    enabled: Boolean(data?.phaseId),
    onEvent: () => void load(),
    onFallbackPoll: () => void load(),
  });

  const sideConfig = {
    ...DEFAULT_SCORING_CONFIG,
    display: {
      ...DEFAULT_SCORING_CONFIG.display,
      sideColors: data?.sideColors ?? DEFAULT_SCORING_CONFIG.display.sideColors,
    },
  };

  if (!data || data.rounds.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center text-sm text-muted">
        {t('publicApp.tournament.swiss.pending')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted">
        {data.finalized
          ? t('publicApp.tournament.swiss.finalisedAfter', {
              done: data.finalized.atRound,
              total: data.roundCount,
            })
          : t('publicApp.tournament.swiss.progress', {
              done: data.roundsCompleted,
              total: data.roundCount,
            })}
      </p>

      {data.rounds.map((round) => (
        <section
          key={round.id}
          className="overflow-hidden rounded-xl border border-border bg-surface"
        >
          <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
            <h3 className="font-display text-lg font-semibold text-foreground">
              {t('publicApp.tournament.swiss.roundTitle', { round: round.roundNumber })}
            </h3>
            {round.warnings.some((warning) => warning.code === 'forced-rematch') && (
              <span
                className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning"
                title={t('publicApp.tournament.swiss.forcedRematchHelp')}
              >
                {t('publicApp.tournament.swiss.forcedRematch')}
              </span>
            )}
            {round.manuallyAdjusted && (
              <span
                className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent"
                title={t('publicApp.tournament.swiss.manuallyAdjustedHelp')}
              >
                {t('publicApp.tournament.swiss.manuallyAdjusted')}
              </span>
            )}
          </header>

          <ul className="divide-y divide-border">
            {round.matches.map((match) => (
              <li
                key={match.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5"
              >
                <span className="w-24 shrink-0 font-mono text-xs text-muted">
                  {match.matchNumberLabel}
                </span>
                <Fighter
                  name={match.redFighterName}
                  club={match.redClubAbbrev}
                  side="red"
                  sideConfig={sideConfig}
                  isWinner={
                    match.winnerRegistrationId !== null &&
                    match.winnerRegistrationId === match.redRegistrationId
                  }
                  isSelf={
                    Boolean(highlightRegistrationId) &&
                    match.redRegistrationId === highlightRegistrationId
                  }
                  youLabel={t('publicApp.me.hub.youChip')}
                />
                <span className="text-sm font-semibold text-foreground-secondary">
                  {match.redScore ?? '–'} : {match.blueScore ?? '–'}
                </span>
                <Fighter
                  name={match.blueFighterName}
                  club={match.blueClubAbbrev}
                  side="blue"
                  sideConfig={sideConfig}
                  isWinner={
                    match.winnerRegistrationId !== null &&
                    match.winnerRegistrationId === match.blueRegistrationId
                  }
                  isSelf={
                    Boolean(highlightRegistrationId) &&
                    match.blueRegistrationId === highlightRegistrationId
                  }
                  youLabel={t('publicApp.me.hub.youChip')}
                />
                {match.liceName && (
                  <span
                    className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted"
                    style={match.liceColorHex ? { borderColor: match.liceColorHex } : undefined}
                  >
                    {match.liceName}
                  </span>
                )}
                {match.scheduledAt && timezone && (
                  <span className="text-xs text-muted">
                    {formatInZone(
                      match.scheduledAt,
                      timezone,
                      { hour: '2-digit', minute: '2-digit' },
                      localeToBcp47(locale),
                    )}
                  </span>
                )}
              </li>
            ))}
            {round.byeRegistrationId && (
              <li className="flex items-center gap-2 px-4 py-2.5 text-sm">
                <span className="rounded-full bg-background px-2 py-0.5 text-[11px] font-semibold text-muted">
                  {t('publicApp.tournament.swiss.bye')}
                </span>
                <span className="font-medium text-foreground">{round.byeFighterName ?? '—'}</span>
              </li>
            )}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Fighter({
  name,
  club,
  side,
  sideConfig,
  isWinner,
  isSelf,
  youLabel,
}: {
  name: string | null;
  club: string | null;
  side: 'red' | 'blue';
  // Per-ITEM colours from the payload — a hardcoded red/blue would be wrong for
  // every tournament that configured something else.
  sideConfig: typeof DEFAULT_SCORING_CONFIG;
  isWinner: boolean;
  isSelf: boolean;
  youLabel: string;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span
        aria-hidden="true"
        className="h-3 w-1 shrink-0 rounded-full"
        style={{ backgroundColor: sideStyle(sideConfig, side).border }}
      />
      <span
        className={`truncate text-sm ${isWinner ? 'font-bold text-foreground' : 'text-foreground-secondary'}`}
      >
        {name ?? '—'}
      </span>
      {club && <span className="shrink-0 text-[11px] text-muted">{club}</span>}
      {isSelf && (
        <span className="shrink-0 rounded bg-accent px-1 py-px text-[9px] font-bold uppercase leading-none text-accent-foreground">
          {youLabel}
        </span>
      )}
    </span>
  );
}
