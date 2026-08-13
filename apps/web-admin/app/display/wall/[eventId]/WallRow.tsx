'use client';
import type { Translator } from '@myclash/next-i18n/client';
import { DOT, type HealthState } from '@/lib/live-board/live-board-state';
import { timingReadout } from '@/lib/live-board/board-timing-labels';
import { matchStatusLabel } from '@/lib/live-board/match-status';
import type { AppLocale } from '@myclash/time';
import type { BoardRow } from '@/lib/live-board/types';

type T = Translator;

/**
 * One piste on the projector.
 *
 * Its own renderer rather than a mode on BoardRowView: the wall has no links,
 * no ack button and no expansion, and it sizes on the stage type scale instead
 * of the admin one. Sharing the row would mean threading a `variant` prop
 * through every cell to switch off most of them.
 */
interface WallRowProps {
  row: BoardRow;
  state: HealthState;
  nowMs: number;
  matchDurationMinutes: number;
  locale: AppLocale;
  t: T;
}

export function WallRow({ row, state, nowMs, matchDurationMinutes, locale, t }: WallRowProps) {
  const cm = row.currentMatch;
  const timing = timingReadout(row, nowMs, matchDurationMinutes, locale, t);

  return (
    <li className="flex items-center gap-4 border-b border-border/40 py-3">
      <span
        role="img"
        aria-label={t(`organizer.live.state.${state}`)}
        className={`h-4 w-4 shrink-0 rounded-full ${DOT[state]}`}
      />
      <span
        className="w-40 shrink-0 truncate font-semibold text-foreground"
        style={{ fontSize: 'var(--text-stage-row)' }}
      >
        {row.lice.name}
      </span>
      <span
        className="min-w-0 flex-1 truncate text-foreground"
        style={{ fontSize: 'var(--text-stage-row)' }}
      >
        {cm
          ? `${cm.redFighterName ?? '—'} ${cm.redScore}–${cm.blueScore} ${cm.blueFighterName ?? '—'}`
          : t('organizer.live.state.idle')}
      </span>
      <span
        className="w-40 shrink-0 truncate text-right tabular-nums text-muted"
        style={{ fontSize: 'var(--text-stage-meta)' }}
      >
        {cm ? matchStatusLabel(cm.status, t) : ''}
        {timing.clock ? ` · ${timing.clock}` : ''}
      </span>
      <span
        className={`w-48 shrink-0 truncate text-right ${timing.warn ? 'text-warning' : 'text-muted'}`}
        style={{ fontSize: 'var(--text-stage-meta)' }}
      >
        {timing.behind ?? ''}
      </span>
    </li>
  );
}
