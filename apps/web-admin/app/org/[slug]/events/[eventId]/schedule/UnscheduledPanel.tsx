'use client';

import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { MatchChip } from './MatchChip';
import type { DragPayload } from './drag-payload';
import type { ScheduleMatch, UnscheduledBracketRound, UnscheduledPool } from './schedule-types';

/**
 * The board's left column: every fight not yet placed, plus the Configure
 * drawer underneath it.
 *
 * It holds no schedule state. Everything it can change, it changes by calling
 * back — including the drop that pulls a fight off the board, which is the
 * grid's `handleUnscheduleDrop`. That matters more than it looks: the panel used
 * to write `setMatches`, push undo and fire the PATCH from a handler defined
 * inline in JSX, which was the last mutation in this file that no name pointed
 * at.
 *
 * It never sees the drag payload ref either — `onDragStart`/`onDragEnd` are the
 * whole surface. See ./drag-payload.
 */

interface Props {
  panelCollapsed: boolean;
  onToggleCollapsed: () => void;
  /** Rendered width in px; the operator drags the right edge to change it. */
  panelWidth: number;
  onBeginResize: (ev: ReactPointerEvent<HTMLDivElement>) => void;
  unscheduled: ScheduleMatch[];
  unscheduledPools: UnscheduledPool[];
  unscheduledBracketRounds: UnscheduledBracketRound[];
  /** Fights already represented by a group block, so their chips are hidden. */
  matchIdsCoveredByPoolBlock: Set<string>;
  matchIdsCoveredByBracketRoundBlock: Set<string>;
  tickedKeys: Set<string>;
  onToggleTicked: (key: string) => void;
  onScheduleSelected: () => void;
  slug: string;
  eventId: string;
  /** The one match currently being written, so its chip dims. */
  savingMatchId: string | null;
  onUnscheduleDrop: () => void;
  onDragStart: (payload: DragPayload) => void;
  onDragEnd: () => void;
  /** The Configure (ProgrammePlanner) drawer, rendered by the page. */
  configurePanel?: ReactNode;
}

/**
 * One draggable group block — a whole pool, or a whole bracket round.
 *
 * Both were written out separately and differed only in tint, which is the
 * shape where a fix lands on one and not the other.
 */
function GroupChip(props: {
  label: string;
  sublabel: string;
  title: string;
  selectAria: string;
  ticked: boolean;
  onToggleTicked: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  /** `bracket` carries the amber accent the individual bracket chips use. */
  tone: 'pool' | 'bracket';
}) {
  const bracket = props.tone === 'bracket';
  return (
    <div
      draggable
      onDragStart={props.onDragStart}
      onDragEnd={props.onDragEnd}
      className={[
        'cursor-grab rounded-md border-2 border-dashed px-2 py-1.5 text-xs',
        bracket
          ? 'border-amber-400 bg-amber-50 hover:border-amber-500 hover:bg-amber-100'
          : 'border-border bg-border hover:border-muted hover:bg-background',
      ].join(' ')}
      title={props.title}
    >
      <div className="flex items-start gap-1.5">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={props.ticked}
          onClick={(e) => e.stopPropagation()}
          onChange={props.onToggleTicked}
          aria-label={props.selectAria}
        />
        <div className="min-w-0">
          <div className={`font-bold truncate ${bracket ? 'text-amber-900' : 'text-foreground'}`}>
            {props.label}
          </div>
          <div
            className={`text-[10px] truncate ${bracket ? 'text-amber-700' : 'text-foreground-secondary'}`}
          >
            {props.sublabel}
          </div>
        </div>
      </div>
    </div>
  );
}

export function UnscheduledPanel({
  panelCollapsed,
  onToggleCollapsed,
  panelWidth,
  onBeginResize,
  unscheduled,
  unscheduledPools,
  unscheduledBracketRounds,
  matchIdsCoveredByPoolBlock,
  matchIdsCoveredByBracketRoundBlock,
  tickedKeys,
  onToggleTicked,
  onScheduleSelected,
  slug,
  eventId,
  savingMatchId,
  onUnscheduleDrop,
  onDragStart,
  onDragEnd,
  configurePanel,
}: Props) {
  const { t } = useI18n();
  return (
    <div
      style={panelCollapsed ? undefined : ({ '--panel-w': `${panelWidth}px` } as CSSProperties)}
      className={
        panelCollapsed
          ? 'w-full lg:sticky lg:top-4 lg:w-10 lg:flex-shrink-0 lg:self-start'
          : 'relative w-full space-y-4 lg:sticky lg:top-4 lg:w-[var(--panel-w)] lg:flex-shrink-0 lg:self-start'
      }
    >
      {!panelCollapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t('organizer.schedulePage.grid.panelResizeAria')}
          onPointerDown={onBeginResize}
          className="absolute -right-1 top-0 z-20 hidden h-full w-2 cursor-col-resize touch-none bg-transparent hover:bg-accent/30 lg:block"
        />
      )}
      <div className="mb-2 flex items-center justify-between gap-2">
        {!panelCollapsed && (
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
            {t('organizer.schedulePage.grid.unscheduledHeading', { count: unscheduled.length })}
          </h2>
        )}
        <button
          type="button"
          aria-expanded={!panelCollapsed}
          aria-label={
            panelCollapsed
              ? t('organizer.schedulePage.grid.expandPanel')
              : t('organizer.schedulePage.grid.collapsePanel')
          }
          onClick={onToggleCollapsed}
          className="rounded-md border border-border px-2 py-0.5 text-sm font-semibold text-foreground-secondary hover:bg-background"
        >
          {panelCollapsed ? '»' : '«'}
        </button>
      </div>
      {!panelCollapsed && (
        <>
          {tickedKeys.size > 0 && (
            <button
              type="button"
              onClick={onScheduleSelected}
              className="mb-2 w-full rounded-md bg-accent px-2 py-1 text-xs font-semibold text-accent-foreground hover:bg-accent-hover"
            >
              {t('organizer.schedulePage.grid.scheduleSelected', { count: tickedKeys.size })}
            </button>
          )}
          <div
            className="flex flex-col gap-1.5 min-h-[100px] border-2 border-dashed border-border rounded-xl p-2 max-h-[60vh] overflow-y-auto"
            onDragOver={(e) => e.preventDefault()}
            onDrop={onUnscheduleDrop}
          >
            {unscheduled.length === 0 ? (
              <p className="px-1 py-2 text-xs italic text-muted">
                {t('organizer.schedulePage.grid.allPlaced')}
              </p>
            ) : (
              <>
                {/* Slice 4: drag a whole pool onto a cell to fan its matches out
                    across lices. Only fully-unscheduled pools render as blocks —
                    the moment the operator places one fight manually, the rest
                    fall back to individual chips. */}
                {unscheduledPools
                  .filter((p) => p.matchIds.every((id) => matchIdsCoveredByPoolBlock.has(id)))
                  .map((pool) => (
                    <GroupChip
                      key={pool.poolId}
                      tone="pool"
                      label={pool.poolName}
                      sublabel={t('organizer.schedulePage.grid.groupChipSub', {
                        tournament: pool.tournamentName ?? '',
                        count: pool.matchIds.length,
                      })}
                      title={t('organizer.schedulePage.grid.groupChipTitle', {
                        count: pool.matchIds.length,
                      })}
                      selectAria={t('organizer.schedulePage.grid.selectAria', {
                        label: pool.poolName,
                      })}
                      ticked={tickedKeys.has(`pool:${pool.poolId}`)}
                      onToggleTicked={() => onToggleTicked(`pool:${pool.poolId}`)}
                      onDragStart={() =>
                        onDragStart({
                          kind: 'pool',
                          poolId: pool.poolId,
                          matchIds: pool.matchIds,
                        })
                      }
                      onDragEnd={onDragEnd}
                    />
                  ))}
                {/* Bracket rounds group the same way pools do — drag a whole
                    round (Play-ins / Round of 16 / …) onto a cell to fan its
                    matches down a lice. */}
                {unscheduledBracketRounds
                  .filter((r) =>
                    r.matchIds.every((id) => matchIdsCoveredByBracketRoundBlock.has(id)),
                  )
                  .map((round) => (
                    <GroupChip
                      key={round.key}
                      tone="bracket"
                      label={round.label}
                      sublabel={t('organizer.schedulePage.grid.groupChipSub', {
                        tournament: round.tournamentName ?? '',
                        count: round.matchIds.length,
                      })}
                      title={t('organizer.schedulePage.grid.groupChipTitle', {
                        count: round.matchIds.length,
                      })}
                      selectAria={t('organizer.schedulePage.grid.selectAria', {
                        label: round.label,
                      })}
                      ticked={tickedKeys.has(`round:${round.key}`)}
                      onToggleTicked={() => onToggleTicked(`round:${round.key}`)}
                      onDragStart={() =>
                        onDragStart({
                          kind: 'bracketRound',
                          key: round.key,
                          matchIds: round.matchIds,
                        })
                      }
                      onDragEnd={onDragEnd}
                    />
                  ))}
                {unscheduled
                  .filter(
                    (m) =>
                      !matchIdsCoveredByPoolBlock.has(m.id) &&
                      !matchIdsCoveredByBracketRoundBlock.has(m.id),
                  )
                  .map((m) => (
                    <MatchChip
                      key={m.id}
                      match={m}
                      slug={slug}
                      eventId={eventId}
                      saving={savingMatchId === m.id}
                      onDragStart={() => onDragStart({ kind: 'match', match: m })}
                      onDragEnd={onDragEnd}
                    />
                  ))}
              </>
            )}
          </div>
          {configurePanel}
        </>
      )}
    </div>
  );
}
