'use client';
import { asColorToken, tintBgClassFor, tintTextClassFor } from '@myclash/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { BoardRowActions } from './BoardRowActions';
import { BoardRowScorer } from './BoardRowScorer';
import { BoardRowTimeline } from './BoardRowTimeline';
import { BoardScorerPicker } from './BoardScorerPicker';
import { timingReadout } from '@/lib/live-board/board-timing-labels';
import { matchStatusLabel } from '@/lib/live-board/match-status';
import type { BoardReferee, BoardRow, LiveBoardAccount } from '@/lib/live-board/types';

type T = ReturnType<typeof useI18n>['t'];

/**
 * The in-place expansion for one piste.
 *
 * Everything here comes off the row the board already polled — no fetch. The
 * point of expanding is to answer "what is actually happening on piste 4"
 * WITHOUT leaving the board, so the organizer keeps sight of the other
 * nineteen.
 */
interface DetailProps {
  row: BoardRow;
  nowMs: number;
  matchDurationMinutes: number;
  eventSlug: string | null;
  accounts: LiveBoardAccount[];
  onAssignScorer: (liceId: string, staffAccountId: string | null) => Promise<string[]>;
  slug: string;
  eventId: string;
  t: T;
}

export function BoardRowDetail({
  row,
  nowMs,
  matchDurationMinutes,
  eventSlug,
  accounts,
  onAssignScorer,
  slug,
  eventId,
  t,
}: DetailProps) {
  const cm = row.currentMatch;
  return (
    <div className="mt-2 grid gap-4 rounded-md bg-surface-2 p-3 text-sm md:grid-cols-3">
      <BoutSection row={row} nowMs={nowMs} matchDurationMinutes={matchDurationMinutes} t={t} />
      <RefereeSection row={row} t={t} />
      <section className="flex flex-col gap-2">
        <h3 className="text-xs uppercase text-muted">{t('organizer.live.detail.scorer')}</h3>
        <BoardRowScorer row={row} nowMs={nowMs} t={t} />
        <BoardScorerPicker
          liceId={row.lice.id}
          currentAccountId={row.scorer?.accountId ?? null}
          accounts={accounts}
          onAssign={onAssignScorer}
          t={t}
        />
        {cm && (
          <BoardRowActions
            matchId={cm.id}
            liceName={row.lice.name}
            eventSlug={eventSlug}
            slug={slug}
            eventId={eventId}
            t={t}
          />
        )}
      </section>
      {cm && (
        <section className="flex flex-col gap-1 md:col-span-3">
          <h3 className="text-xs uppercase text-muted">{t('organizer.live.detail.timeline')}</h3>
          <BoardRowTimeline matchId={cm.id} t={t} />
        </section>
      )}
    </div>
  );
}

/** What is being fought, how far in, and what came before. */
function BoutSection({
  row,
  nowMs,
  matchDurationMinutes,
  t,
}: {
  row: BoardRow;
  nowMs: number;
  matchDurationMinutes: number;
  t: T;
}) {
  const { locale } = useI18n();
  const cm = row.currentMatch;
  const timing = timingReadout(row, nowMs, matchDurationMinutes, locale, t);
  const context = cm
    ? [cm.tournamentName, cm.poolName ?? (cm.round ? `R${cm.round}` : null), cm.matchNumberLabel]
        .filter(Boolean)
        .join(' · ')
    : null;

  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-xs uppercase text-muted">{t('organizer.live.detail.bout')}</h3>
      {cm ? (
        <>
          {context && <p className="text-foreground">{context}</p>}
          <p className="text-muted">{matchStatusLabel(cm.status, t)}</p>
          {(timing.clock || timing.behind) && (
            <p className={timing.warn ? 'text-warning' : 'text-muted'}>
              <span className="tabular-nums">{timing.clock}</span>
              {timing.clock && timing.behind ? ' · ' : ''}
              {timing.behind}
            </p>
          )}
        </>
      ) : (
        <p className="text-muted">{t('organizer.live.state.idle')}</p>
      )}
      {row.lastCompleted && (
        <p className="text-muted">
          {t('organizer.live.detail.lastBout', { label: row.lastCompleted.label || '—' })}
        </p>
      )}
    </section>
  );
}

/** Who is officiating, and what this piste runs next. */
function RefereeSection({ row, t }: { row: BoardRow; t: T }) {
  const referees = row.currentMatch?.referees ?? [];
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-xs uppercase text-muted">{t('organizer.live.detail.referees')}</h3>
      {referees.length > 0 ? (
        <ul className="flex flex-wrap gap-1">
          {referees.map((ref) => (
            <RefereeChip key={`${ref.name}-${ref.roleLabel ?? ''}`} referee={ref} />
          ))}
        </ul>
      ) : (
        <p className="text-muted">{t('organizer.live.detail.noReferees')}</p>
      )}
      {row.queue.length > 0 && (
        <>
          <h3 className="mt-2 text-xs uppercase text-muted">{t('organizer.live.detail.queue')}</h3>
          <p className="text-muted">{row.queue.map((q) => q.label || '—').join(' · ')}</p>
        </>
      )}
    </section>
  );
}

/**
 * `roleColor` is a design ColorToken ('amber', 'slate'), never a hex value —
 * so it goes through the shared token→class table rather than into a style
 * attribute.
 */
function RefereeChip({ referee }: { referee: BoardReferee }) {
  const token = asColorToken(referee.roleColor);
  return (
    <li
      className={`rounded-full px-2 py-0.5 text-xs ${tintBgClassFor(token)} ${tintTextClassFor(token)}`}
    >
      {referee.name}
      {referee.roleLabel && <span className="opacity-70"> · {referee.roleLabel}</span>}
    </li>
  );
}
