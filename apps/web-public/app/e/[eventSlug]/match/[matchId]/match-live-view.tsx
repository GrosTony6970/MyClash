'use client';

import { useCallback, useState } from 'react';
import { FreshnessChip, TournamentColorDot, sideColorsFor, statusLabelKey } from '@myclash/ui';
import { apiRequest } from '@myclash/api-client';
import { formatInZone, localeToBcp47 } from '@myclash/time';
import { getPublicApiUrl } from '@/lib/api-url';
import { useRealtimeDisabled } from '@/lib/supabase-browser';
import { BackLink } from '@/components/BackLink';
import { ShareButton } from '@/components/ShareButton';
import { useI18n } from '@myclash/next-i18n/client';
import { resolveMatchWinner } from '@myclash/types';
import { useMatchLiveChannel } from './use-match-live-channel';
import { MatchEventFeed } from './match-event-feed';
import {
  mapMatchRow,
  type ExchangeRow,
  type MatchPenaltyRow,
  type MatchProtest,
  type MatchRow,
  type MatchSummary,
} from './match-row';

// ── Sub-components ───────────────────────────────────────────────────────────

/** A team side's colour chip before its name (call 6). A Fighter's side has none, and no space. */
function SideName({ name, colour }: { name: string; colour: string | null }) {
  return (
    <>
      {colour && (
        <>
          <TournamentColorDot color={colour} size="em" />{' '}
        </>
      )}
      {name}
    </>
  );
}

/**
 * One side under its score: a team's logo, then the name with its chip, then a Fighter's club.
 * The logo sits where the TV puts a Fighter's photo (call 6). It is decorative (`alt=""`): the
 * team's name is the text right under it, and a screen reader would read it twice (WAI H2). This
 * page shows no Fighter photo, so a side with no logo shows the name alone.
 */
function SideLabel({
  name,
  club,
  colour,
  logoUrl,
}: {
  name: string;
  club: string | null;
  colour: string | null;
  logoUrl: string | null;
}) {
  return (
    <>
      {logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- a storage link, not a next/image source
        <img
          src={logoUrl}
          alt=""
          width={48}
          height={48}
          className="h-12 w-12 rounded-full border border-border bg-background object-contain"
        />
      )}
      <span className="text-sm font-semibold text-foreground">
        <SideName name={name} colour={colour} />
      </span>
      {club && <span className="text-xs text-muted">{club}</span>}
    </>
  );
}

function ScoreBoard({ match, summary }: { match: MatchRow; summary: MatchSummary }) {
  const { t, locale } = useI18n();
  // The organiser's configured side colours, not a generic red/blue: a
  // tournament run white-vs-black must read white-vs-black here too, exactly as
  // it already does on the pad and the projector. `legibleOn` keeps the white
  // and black tokens from vanishing into this light page.
  const colors = sideColorsFor(summary.scoringConfig, 'light');

  // By side key: a team bout's winner is its team, and a forfeit can win on the lower score.
  const winner = resolveMatchWinner({
    status: match.status,
    winnerSideId: match.winnerSideId,
    redSideId: match.redSideId,
    blueSideId: match.blueSideId,
    redScore: match.redScore,
    blueScore: match.blueScore,
  });
  const winnerName = winner === 'red' ? summary.redName : winner === 'blue' ? summary.blueName : '';
  const winnerColour =
    winner === 'red' ? summary.redColour : winner === 'blue' ? summary.blueColour : null;
  // The bout's code (`LSW-P4-M1`), never its stored label (`L1-PD-M01`): the
  // stored one is an internal sort key a visitor cannot read. Empty when the
  // summary could not be read, and then no line is drawn.
  const label = summary.roundCode;

  // Score emphasis: when there's a winner, the loser's score drops to the muted ink and the
  // winner keeps the side colour; otherwise both keep it. The loser was the side colour at 40%,
  // 1.8:1 to 2.6:1 (known-deviations D29).
  const isLoser = (side: 'red' | 'blue') => !!winner && winner !== side;
  const scoreClass = (side: 'red' | 'blue') => {
    if (!winner) return '';
    return winner === side ? 'font-black' : 'text-muted';
  };
  const scoreStyle = (side: 'red' | 'blue') => ({
    color: side === 'red' ? colors.red : colors.blue,
  });
  const bigScoreStyle = (side: 'red' | 'blue') => (isLoser(side) ? undefined : scoreStyle(side));

  const fmtTime = (iso: string | null) =>
    formatInZone(
      iso,
      summary.eventTimezone,
      { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' },
      localeToBcp47(locale),
    );

  return (
    <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
      {label && (
        <p className="mb-3 text-center text-xs font-medium tracking-widest text-muted uppercase">
          {label}
        </p>
      )}

      {summary.bestOf > 1 && (
        <p className="mb-3 text-center text-xs font-bold tracking-wide text-info">
          {t('scoring.rounds.counter', {
            current: String(match.currentRound),
            total: String(summary.bestOf),
          })}
          {' · '}
          {t('scoring.rounds.seriesTally')}{' '}
          <span style={scoreStyle('red')}>{match.redRoundWins}</span>
          <span className="text-muted">–</span>
          <span style={scoreStyle('blue')}>{match.blueRoundWins}</span>
        </p>
      )}

      <div className="flex items-start justify-between gap-4">
        {/* Red side */}
        <div className="flex flex-1 flex-col items-center gap-1 text-center">
          <span
            className={`text-6xl font-bold tabular-nums ${scoreClass('red')}`}
            style={bigScoreStyle('red')}
          >
            {match.redScore}
          </span>
          <SideLabel
            name={summary.redName || t('scoring.liveMatch.red')}
            club={summary.redClub}
            colour={summary.redColour}
            logoUrl={summary.redLogoUrl}
          />
        </div>

        {/* Divider */}
        <span className="mt-8 text-3xl font-light text-muted">–</span>

        {/* Blue side */}
        <div className="flex flex-1 flex-col items-center gap-1 text-center">
          <span
            className={`text-6xl font-bold tabular-nums ${scoreClass('blue')}`}
            style={bigScoreStyle('blue')}
          >
            {match.blueScore}
          </span>
          <SideLabel
            name={summary.blueName || t('scoring.liveMatch.blue')}
            club={summary.blueClub}
            colour={summary.blueColour}
            logoUrl={summary.blueLogoUrl}
          />
        </div>
      </div>

      {/* Meta: winner, start/end, referee, status */}
      <div className="mt-5 flex flex-col items-center gap-1 border-t border-border pt-4 text-center">
        {summary.bestOf > 1 && match.awaitingRoundAdvance && (
          <p className="text-sm font-bold text-info">
            {t('scoring.rounds.roundComplete', { round: String(match.currentRound) })}
          </p>
        )}
        {winnerName && (
          <p className="text-lg font-black text-foreground">
            🏆 <SideName name={winnerName} colour={winnerColour} />
          </p>
        )}
        {(match.startedAt || match.endedAt) && (
          <p className="text-xs text-muted">
            {match.startedAt && `${t('scoring.liveMatch.started')} ${fmtTime(match.startedAt)}`}
            {match.startedAt && match.endedAt && ' · '}
            {match.endedAt && `${t('scoring.liveMatch.ended')} ${fmtTime(match.endedAt)}`}
          </p>
        )}
        {summary.referees.length > 0 && (
          <p className="text-xs text-muted">
            {t('scoring.liveMatch.referee')}: {summary.referees.join(', ')}
          </p>
        )}
        <span className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted">
          {t(statusLabelKey('match', match.status))}
        </span>
      </div>
    </div>
  );
}

// ── Main client component ────────────────────────────────────────────────────

interface Props {
  matchId: string;
  initialMatch: MatchRow;
  initialSummary: MatchSummary;
  initialExchanges: ExchangeRow[];
  initialPenalties: MatchPenaltyRow[];
  initialProtests: MatchProtest[];
  /** Where the top back-link leads (validated root-relative path). */
  backHref: string;
  /** What the back-link says, as a key: `backLabelKey` of `@/lib/bout-page` decides. */
  backLabelKey: string;
  /** The bout's plain address, for its Share button: `boutPagePath` of `@/lib/bout-page`. */
  sharePath: string;
}

export function MatchLiveView({
  matchId,
  initialMatch,
  initialSummary,
  initialExchanges,
  initialPenalties,
  initialProtests,
  backHref,
  backLabelKey,
  sharePath,
}: Props) {
  // Resolved here, not handed down from the server page: a server-resolved URL
  // is the docker-internal host, which the browser can't reach — the polling
  // fallback and post-reconnect catch-up refresh both run in the browser.
  const apiUrl = getPublicApiUrl();
  const { t } = useI18n();
  const [match, setMatch] = useState<MatchRow>(initialMatch);
  const [summary, setSummary] = useState<MatchSummary>(initialSummary);
  const [exchanges, setExchanges] = useState<ExchangeRow[]>(initialExchanges);
  const [penalties, setPenalties] = useState<MatchPenaltyRow[]>(initialPenalties);
  const [protests, setProtests] = useState<MatchProtest[]>(initialProtests);
  // disable_realtime kill-switch — when on, the channel hook degrades to polling.
  const realtimeDisabled = useRealtimeDisabled();

  // A finished match is static — no realtime channel needed.
  const isFinal = initialMatch.status === 'completed' || initialMatch.status === 'voided';

  /**
   * Volatile state only. `/summary` is deliberately absent: fighter names,
   * clubs, referees, `scoringConfig`, `bestOf` and `matchFormat` do not change
   * mid-bout, and leaving it out takes the fallback poll from five requests to
   * four — see FALLBACK_POLL_MS for why that margin matters at a venue, where
   * every phone shares one public IP.
   */
  const refreshLive = useCallback(async () => {
    try {
      const [matchRes, exRes, penaltyRes, protestRes] = await Promise.all([
        fetch(`${apiUrl}/api/v1/matches/${matchId}`, { credentials: 'include' }),
        fetch(`${apiUrl}/api/v1/matches/${matchId}/exchanges`, { credentials: 'include' }),
        fetch(`${apiUrl}/api/v1/matches/${matchId}/penalties`, { credentials: 'include' }),
        apiRequest<MatchProtest[]>(apiUrl, `/api/v1/matches/${matchId}/protests`),
      ]);
      if (matchRes.ok) setMatch(mapMatchRow((await matchRes.json()) as Record<string, unknown>));
      if (exRes.ok) setExchanges((await exRes.json()) as ExchangeRow[]);
      if (penaltyRes.ok) setPenalties((await penaltyRes.json()) as MatchPenaltyRow[]);
      if (protestRes.ok) setProtests(protestRes.data);
    } catch {
      // network failure — stay with current state
    }
  }, [matchId, apiUrl]);

  /** Everything, summary included — the reconnect backfill, where a referee or
   *  config change made during the outage also has to land. */
  const refresh = useCallback(async () => {
    await Promise.all([
      refreshLive(),
      (async () => {
        try {
          const res = await fetch(`${apiUrl}/api/v1/matches/${matchId}/summary`, {
            credentials: 'include',
          });
          if (res.ok) setSummary((await res.json()) as MatchSummary);
        } catch {
          // network failure — stay with current state
        }
      })(),
    ]);
  }, [refreshLive, matchId, apiUrl]);

  const freshness = useMatchLiveChannel({
    matchId,
    isFinal,
    // The live row, not the initial one — a bout that starts while the page is
    // open must speed the poll up, and a hidden one that ends stop it, without a reload.
    match,
    realtimeDisabled,
    refresh,
    refreshLive,
    setMatch,
    setExchanges,
    setPenalties,
    setProtests,
  });

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        {/* In a box of its own: the link aligns itself to the top of a row. */}
        <div>
          <BackLink href={backHref} label={t(backLabelKey)} />
        </div>
        {/* Not on a bout the public cannot read: the link would say "not found". */}
        {!match.hiddenFromPublic && <ShareButton path={sharePath} />}
      </div>

      {/* Freshness — the shared chip, so this page and the TV board can no
          longer disagree about what is true. A finished match is static and has
          nothing to be fresh about, so it says nothing at all. Otherwise the
          chip stays up even while the poll is carrying the page: for a
          spectator refreshing a phone, "updates are slower" is worth knowing,
          which is the judgement `polling` exists to express without pretending
          updates have stopped. */}
      {!isFinal && <FreshnessChip freshness={freshness} t={t} className="mb-4" quietWhenLive />}

      <ScoreBoard match={match} summary={summary} />
      <MatchEventFeed
        exchanges={exchanges}
        penalties={penalties}
        protests={protests}
        match={match}
        summary={summary}
        redName={summary.redName || t('scoring.liveMatch.red')}
        blueName={summary.blueName || t('scoring.liveMatch.blue')}
      />
    </div>
  );
}
