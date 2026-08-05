import Link from 'next/link';

/**
 * One live match card — the red–blue scoreboard tile shared by the event home
 * "Live now" list (client, auto-refreshing) and the accompanist home (server,
 * followed fighters). Presentational and hook-free, so it renders in both a
 * server and a client component. The whole card links to the per-match live view.
 */
export interface LiveMatchCardMatch {
  id: string;
  matchNumberLabel: string;
  redFighterName: string | null;
  blueFighterName: string | null;
  redScore: number;
  blueScore: number;
  liceName: string | null;
  /** Absent on the accompanist (followed-fighters) feed. */
  tournamentName?: string | null;
}

export function LiveMatchCard({
  match,
  href,
  pausedLabel,
}: {
  match: LiveMatchCardMatch;
  href: string;
  /**
   * Rendered as a badge when the bout is halted. A paused bout still holds
   * its piste, so it stays on the board — but the spectator has to be able
   * to tell a live exchange from a stopped clock. Passed in already
   * translated: this card is hook-free so it renders on the server too.
   */
  pausedLabel?: string | null;
}) {
  const meta = [match.tournamentName, match.matchNumberLabel, match.liceName]
    .filter((v): v is string => Boolean(v))
    .join(' · ');
  return (
    <Link
      href={href}
      className="block rounded-xl border border-success/40 bg-surface p-4 shadow-sm transition-colors hover:border-success focus:outline-none focus:ring-2 focus:ring-accent/40"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs text-muted">{meta}</p>
        {pausedLabel && (
          <span className="shrink-0 rounded-full bg-border px-2 py-0.5 text-xs font-bold text-muted">
            {pausedLabel}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between">
        <p className="font-bold text-foreground">{match.redFighterName ?? '?'}</p>
        <p className="text-2xl font-black tabular-nums text-foreground">
          <span className={match.redScore > match.blueScore ? 'text-success' : undefined}>
            {match.redScore}
          </span>
          <span className="mx-1.5 text-muted">–</span>
          <span className={match.blueScore > match.redScore ? 'text-success' : undefined}>
            {match.blueScore}
          </span>
        </p>
        <p className="font-bold text-foreground">{match.blueFighterName ?? '?'}</p>
      </div>
    </Link>
  );
}
