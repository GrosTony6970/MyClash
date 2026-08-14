'use client';

import { Fragment } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { accentClassFor, tintBgClassFor, tintBorderClassFor } from '@myclash/ui';
import { POOL_HEADER_SPAN } from './pool-header-layout';
import type { DragPayload } from './drag-payload';
import type { HeaderRunGroup } from './schedule-types';

/**
 * One tinted band + bold strip per contiguous same-pool / same-bracket-round
 * run on a lice ("Pool 1", "Semi-finals", …).
 *
 * Separating a match — another lice, a time gap, another fight wedged in —
 * splits the run, so each cluster keeps its own header and the header's drag
 * and clear scope to just that cluster.
 *
 * The band is `pointer-events: none` on purpose: it covers the fights inside
 * the run, and without that the operator could no longer drag an individual
 * card out. The strip re-enables them for itself.
 */

interface Props {
  groups: HeaderRunGroup[];
  rowFor: (slot: number) => number;
  onClearRun: (group: HeaderRunGroup) => void;
  onDragStart: (payload: DragPayload) => void;
  onDragEnd: () => void;
}

export function DetailedRunHeaders({ groups, rowFor, onClearRun, onDragStart, onDragEnd }: Props) {
  const { t } = useI18n();
  return (
    <>
      {groups.map((group) => {
        // The header sits in its own reserved rows ABOVE the run's first match
        // (`rowFor` already carries this run's shift). The band wraps both.
        const matchRowStart = rowFor(group.startSlot);
        const headerRowStart = matchRowStart - POOL_HEADER_SPAN;
        const bandRowEnd = rowFor(group.endSlot);
        return (
          <Fragment key={group.key}>
            <div
              aria-hidden="true"
              className={[
                'pointer-events-none rounded-md border-2 border-dashed',
                tintBgClassFor(group.tournamentColor),
                tintBorderClassFor(group.tournamentColor),
              ].join(' ')}
              style={{
                gridColumn: group.liceIndex + 2,
                gridRow: `${headerRowStart} / ${bandRowEnd}`,
                margin: '1px',
                opacity: 0.45,
                zIndex: 5,
              }}
            />
            {/* The strip the operator drags to move the whole run. It carries a
                bracketRound payload — a plain matchIds group — so the drop lands
                on the existing group-drop path, which re-fans pools and rounds
                alike. */}
            <div
              draggable
              role="button"
              tabIndex={0}
              onDragStart={() =>
                onDragStart({ kind: 'bracketRound', key: group.key, matchIds: group.matchIds })
              }
              onDragEnd={onDragEnd}
              onClick={() => onClearRun(group)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                  ev.preventDefault();
                  onClearRun(group);
                }
              }}
              title={`${group.label}${group.tournamentName ? ` - ${group.tournamentName}` : ''} ${
                group.matchCount === 1
                  ? t('organizer.schedulePage.grid.runHeaderHintSingular', {
                      count: group.matchCount,
                    })
                  : t('organizer.schedulePage.grid.runHeaderHintPlural', {
                      count: group.matchCount,
                    })
              }`}
              className={[
                'flex items-center justify-between gap-1 rounded-t-md border border-b-0 px-3 py-2 text-sm font-bold shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow',
                accentClassFor(group.tournamentColor),
                tintBorderClassFor(group.tournamentColor),
                'text-white',
              ].join(' ')}
              style={{
                gridColumn: group.liceIndex + 2,
                gridRow: `${headerRowStart} / ${matchRowStart}`,
                marginLeft: '1px',
                marginRight: '1px',
                zIndex: 12,
                pointerEvents: 'auto',
              }}
            >
              <span className="truncate">
                {group.label}
                {group.tournamentName ? ` - ${group.tournamentName}` : ''}
              </span>
              <span className="text-xs opacity-90">· {group.matchCount}</span>
            </div>
          </Fragment>
        );
      })}
    </>
  );
}
