'use client';
import { formatMinuteSpan } from '@myclash/time';
import { useI18n } from '@/i18n/I18nProvider';
import { isClockSkewed } from '@/lib/live-board/live-board-state';
import type { BoardRow } from '@/lib/live-board/types';

type T = ReturnType<typeof useI18n>['t'];

/**
 * The tablet behind this piste: who is on it, when it last checked in, and
 * what its outbox looks like.
 *
 * The collapsed row shows a single glyph for all of this. The expansion is
 * where an organizer works out WHY a piste is amber — a full outbox and a
 * tablet that stopped checking in are different problems with different fixes.
 */
export function BoardRowScorer({ row, nowMs, t }: { row: BoardRow; nowMs: number; t: T }) {
  const { locale } = useI18n();
  const scorer = row.scorer;
  if (!scorer) return <p className="text-muted">{t('organizer.live.state.no_scorer')}</p>;

  const seenMs = scorer.lastSeenAt ? Date.parse(scorer.lastSeenAt) : NaN;
  const seenAgo = Number.isNaN(seenMs)
    ? null
    : formatMinuteSpan(Math.max(0, nowMs - seenMs), locale);

  return (
    <div className="flex flex-col gap-1">
      <p className="text-foreground">
        {scorer.name}
        {scorer.username && <span className="text-muted"> · {scorer.username}</span>}
      </p>
      <p className="text-muted">
        {seenAgo
          ? t('organizer.live.detail.lastSeen', { span: seenAgo })
          : t('organizer.live.detail.neverSeen')}
      </p>
      {row.health === null ? (
        <p className="text-muted">{t('organizer.live.unknown')}</p>
      ) : (
        <>
          <p className={row.health.rejectedCount > 0 ? 'text-danger' : 'text-muted'}>
            {t('organizer.live.detail.outbox', {
              queued: row.health.outboxDepth,
              rejected: row.health.rejectedCount,
            })}
          </p>
          {/* Only when it is actually out. A tablet within the noise floor gets
              no line at all rather than a reassuring "clock OK" — this row is
              for problems, and an unmeasured clock must not read as a good one. */}
          {isClockSkewed(row.health.clockSkewMs) && (
            <p className="text-warning" data-testid="clock-skew">
              {t('organizer.live.detail.clockSkew', {
                span: formatMinuteSpan(Math.abs(row.health.clockSkewMs as number), locale),
                direction: t(
                  (row.health.clockSkewMs as number) > 0
                    ? 'organizer.live.detail.clockAhead'
                    : 'organizer.live.detail.clockBehind',
                ),
              })}
            </p>
          )}
        </>
      )}
      {scorer.others.length > 0 && (
        <p className="text-muted">
          {t('organizer.live.detail.alsoAssigned', {
            names: scorer.others.map((o) => o.name).join(', '),
          })}
        </p>
      )}
    </div>
  );
}
