'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { tintBgClassFor, tintBorderClassFor, tintTextClassFor } from '@myclash/ui';
import { matchSlotSpan } from './block-geometry';
import { openMatchScoring } from './open-match-scoring';
import type { DragPayload } from './drag-payload';
import type { Lice, ScheduleMatch } from './schedule-types';

/**
 * The fights placed on the Detailed board.
 *
 * `draggable`, the round code in the card's text, and a `gridRowStart` that
 * lines up with the drop cells' are all read by
 * tests/drag/schedule-grid.spec.ts — it finds a card by its text and resolves
 * which slot it sits in by matching rows against the cells. `rowFor` therefore
 * has to be the SAME function the cells use, not a second copy.
 *
 * Column index comes from `visibleLices`, never the full lice list: it has to
 * agree with the header and cell loops or a hall filter would move cards into
 * the wrong column instead of hiding them.
 */

interface Props {
  matches: ScheduleMatch[];
  visibleLices: Lice[];
  /** ISO instant → slot on the active day's axis. Owned by the grid, which
   *  holds the event timezone. */
  slotOf: (iso: string) => number;
  rowFor: (slot: number) => number;
  /** Ids of fights double-booking a person — the tint that overrides the
   *  tournament colour. Derived once by the grid and shared with the Blocks
   *  view, rather than re-scanning the conflict list per card. */
  conflictMatchIds: Set<string>;
  savingMatchId: string | null;
  slug: string;
  eventId: string;
  onDragStart: (payload: DragPayload) => void;
  onDragEnd: () => void;
}

export function DetailedMatchCards({
  matches,
  visibleLices,
  slotOf,
  rowFor,
  conflictMatchIds,
  savingMatchId,
  slug,
  eventId,
  onDragStart,
  onDragEnd,
}: Props) {
  const { t } = useI18n();
  return (
    <>
      {matches.map((m) => {
        const liceIndex = visibleLices.findIndex((l) => l.id === m.liceId);
        if (liceIndex === -1) return null;
        const slot = slotOf(m.scheduledAt!);
        const span = matchSlotSpan(m.durationMinutes);
        const hasConflict = conflictMatchIds.has(m.id);
        // Cards tint by the parent tournament's colour so the board reads as a
        // horizontal flow of tournaments; the round code text already signals
        // pool-vs-bracket. A conflict overrides both — it has to stay the
        // dominant signal.
        return (
          // eslint-disable-next-line jsx-a11y/click-events-have-key-events -- draggable match card; onClick is a modifier-gated (ctrl/meta) shortcut, not the primary affordance
          <div
            key={m.id}
            draggable
            onDragStart={() => onDragStart({ kind: 'match', match: m })}
            onDragEnd={onDragEnd}
            onClick={(e) => {
              if (!(e.ctrlKey || e.metaKey)) return;
              e.preventDefault();
              openMatchScoring(slug, eventId, m.id);
            }}
            className={[
              'rounded text-xs font-medium px-1 flex items-center cursor-grab active:cursor-grabbing overflow-hidden z-10 border',
              hasConflict
                ? 'bg-danger/10 border-danger/30 text-danger'
                : `${tintBgClassFor(m.tournamentColor)} ${tintBorderClassFor(m.tournamentColor)} ${tintTextClassFor(m.tournamentColor)}`,
              savingMatchId === m.id ? 'opacity-50' : '',
            ].join(' ')}
            style={{
              gridColumn: liceIndex + 2, // +1 for time-label col, +1 for 1-based
              gridRow: `${rowFor(slot)} / span ${span}`, // rowFor already carries the reserved pool-header rows
              margin: '1px',
            }}
            title={`${m.roundCode || m.matchNumberLabel} · ${t('organizer.schedulePage.grid.ctrlClickHint')}${m.tournamentName ? ` · ${m.tournamentName}` : ''}${m.poolName ? ` · ${m.poolName}` : ''}: ${t('organizer.schedulePage.grid.versus', { a: m.redFighterName ?? '?', b: m.blueFighterName ?? '?' })}`}
          >
            <span className="truncate">{m.roundCode || m.matchNumberLabel}</span>
          </div>
        );
      })}
    </>
  );
}
