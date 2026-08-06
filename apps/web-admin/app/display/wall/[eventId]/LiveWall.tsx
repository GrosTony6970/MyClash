'use client';
import { useSecondsClock } from '@myclash/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { getPublicApiUrl } from '@/lib/api-url';
import { groupBoardRows } from '@/lib/live-board/board-groups';
import { sortBoardRows } from '@/lib/live-board/live-board-state';
import { fallbackTiming } from '@/lib/live-board/live-board-timing';
import { useBoardStates } from '@/lib/live-board/use-board-states';
import { useLiveBoard } from '@/lib/live-board/useLiveBoard';
import { WallRow } from './WallRow';

/** Readable from across a hall — the wall never shows a bare spinner. */
function StageMessage({ children }: { children: React.ReactNode }) {
  return (
    <p className="p-12 text-muted" style={{ fontSize: 'var(--text-stage-subtitle)' }}>
      {children}
    </p>
  );
}

/**
 * The whole event on one screen, worst piste first.
 *
 * Read-only by design: no ack, no expansion, no links. A projector is watched
 * from across a hall, so the only decisions it makes are which piste is most
 * urgent and how far behind the day is running.
 *
 * Auth needs nothing extra. It is same-origin under the admin host, so the
 * session cookie rides useLiveBoard's `credentials: 'include'` exactly as
 * /display/[matchId] does, and getLiveBoard's own org-role check still gates
 * it. Without a session it 403s and the stage says so — a projector still
 * running after the operator's session expired must announce that rather than
 * go quietly blank.
 */
export function LiveWall({ eventId }: { eventId: string }) {
  const { t, locale } = useI18n();
  const { rows, timing, error } = useLiveBoard(eventId);
  const { nowMs } = useSecondsClock(getPublicApiUrl());
  const clock = timing ?? fallbackTiming(nowMs);
  const stateOf = useBoardStates(rows, nowMs, clock.matchDurationMinutes);

  if (error === 'forbidden') return <StageMessage>{t('organizer.live.forbidden')}</StageMessage>;
  if (!rows) return <StageMessage>{t('common.loading')}</StageMessage>;

  // Worst-first is hardcoded: nobody is standing at the projector to change it,
  // and the piste that needs a human is the reason the screen is on the wall.
  const groups = groupBoardRows(sortBoardRows(rows, 'worst', stateOf));

  return (
    <div className="h-screen overflow-y-auto px-8 py-6">
      {groups.map((group) => (
        <section key={group.key} className="mb-6">
          {group.label && (
            <h2
              className="mb-1 uppercase tracking-wide text-muted"
              style={{ fontSize: 'var(--text-stage-label)' }}
            >
              {group.label}
            </h2>
          )}
          <ul>
            {group.rows.map((row) => (
              <WallRow
                key={row.lice.id}
                row={row}
                state={stateOf(row)}
                nowMs={nowMs}
                matchDurationMinutes={clock.matchDurationMinutes}
                locale={locale}
                t={t}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
