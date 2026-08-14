'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { openMatchScoring } from './open-match-scoring';
import type { ScheduleMatch } from './schedule-types';

interface Props {
  match: ScheduleMatch;
  slug: string;
  eventId: string;
  saving: boolean;
  onDragStart: () => void;
  /** Required, not optional: a chip that starts a drag and never ends it leaves
   *  a payload standing for the next drop to act on. See ./drag-payload. */
  onDragEnd: () => void;
}

/**
 * One unscheduled match in the left panel: a draggable chip carrying the match
 * code, a phase badge and the two fighter names.
 *
 * Props-only — it holds no schedule state and reads nothing from the grid. The
 * placed cards on the Detailed view are a different component; this one is only
 * ever rendered in the Unscheduled list.
 */
export function MatchChip({ match, slug, eventId, saving, onDragStart, onDragEnd }: Props) {
  const { t } = useI18n();
  // Swiss is neither pool nor bracket: it gets its own badge so an organiser
  // can tell a Swiss round from an elimination round at a glance on the grid.
  const isSwiss = match.phaseType === 'swiss';
  const isBracket = match.phaseType !== null && match.phaseType !== 'pool' && !isSwiss;
  const badgeTint = isBracket ? 'bg-amber-100 text-amber-800' : 'bg-sky-100 text-sky-800';
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events -- draggable match card; onClick is a modifier-gated (ctrl/meta) shortcut, not the primary affordance
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={(e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        openMatchScoring(slug, eventId, match.id);
      }}
      title={`${match.roundCode || match.matchNumberLabel} · ${t('organizer.schedulePage.grid.ctrlClickHint')}`}
      className={[
        'border rounded-lg px-2 py-1.5 text-xs cursor-grab active:cursor-grabbing bg-surface hover:border-muted transition-colors',
        isBracket ? 'border-amber-300' : isSwiss ? 'border-sky-300' : 'border-border',
        saving ? 'opacity-50' : '',
      ].join(' ')}
    >
      <div className="flex items-center gap-1">
        <p className="flex-1 font-medium text-foreground truncate">
          {match.roundCode || match.matchNumberLabel}
        </p>
        {(isBracket || isSwiss) && (
          <span className={`shrink-0 rounded px-1 py-px text-[10px] ${badgeTint}`}>
            {isBracket
              ? t('organizer.schedulePage.grid.bracketBadge')
              : t('organizer.schedulePage.grid.swissBadge')}
          </span>
        )}
      </div>
      <p className="text-muted truncate">
        {t('organizer.schedulePage.grid.versus', {
          a: match.redFighterName ?? '?',
          b: match.blueFighterName ?? '?',
        })}
      </p>
    </div>
  );
}
