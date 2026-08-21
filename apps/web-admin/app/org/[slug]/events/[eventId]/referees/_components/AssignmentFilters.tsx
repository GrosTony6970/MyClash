'use client';

/**
 * The filter card above the referee workspace's timeline.
 *
 * Two rows, deliberately different controls:
 *
 *   Day        single-select, with an "All days" sentinel. You are on one day
 *              or you are looking at the whole event.
 *   Tournament multi-select, every option on by default. Deselecting down to
 *              zero is legal and leaves the timeline empty — a filter that
 *              refuses its own last toggle is a rule nobody can see.
 *
 * See docs/decisions/ADR-014 for why the two rows are not harmonised.
 *
 * This card renders OUTSIDE the lock-dimming wrapper: locking freezes
 * assignments, not looking.
 */

import type { ReactNode } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { filterChipClasses } from './filter-chip-classes';
import { allTournamentsSelected, type TournamentOption } from './filter-board-pools';

export interface DayOption {
  iso: string;
  /** Already formatted by the caller, which owns the locale. */
  label: string;
}

interface Props {
  days: DayOption[];
  selectedDayIso: string | null;
  onSelectDay: (iso: string | null) => void;
  tournaments: TournamentOption[];
  selectedTournamentIds: string[];
  onToggleTournament: (id: string) => void;
  onSelectAllTournaments: () => void;
}

function FilterChip({
  label,
  selected,
  onClick,
  capitalized,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  capitalized?: boolean;
}) {
  const classes = filterChipClasses(selected);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={capitalized ? `${classes} capitalize` : classes}
    >
      {label}
    </button>
  );
}

/** One labelled row. Its own function so neither row crosses the 50-line bar. */
function FilterChipRow({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
      <span
        id={id}
        className="w-28 shrink-0 text-xs font-semibold uppercase tracking-wider text-muted"
      >
        {label}
      </span>
      <div role="group" aria-labelledby={id} className="flex flex-wrap items-center gap-2">
        {children}
      </div>
    </div>
  );
}

/** Single-select with an "All days" sentinel. */
function DayRow({
  days,
  selectedDayIso,
  onSelectDay,
}: Pick<Props, 'days' | 'selectedDayIso' | 'onSelectDay'>) {
  const { t } = useI18n();
  return (
    <FilterChipRow id="referee-filter-day" label={t('organizer.refereesPage.dayFilterLabel')}>
      <FilterChip
        label={t('organizer.refereesPage.dayFilterAll')}
        selected={selectedDayIso === null}
        onClick={() => onSelectDay(null)}
      />
      {days.map((day) => (
        <FilterChip
          key={day.iso}
          label={day.label}
          capitalized
          selected={selectedDayIso === day.iso}
          onClick={() => onSelectDay(day.iso)}
        />
      ))}
    </FilterChipRow>
  );
}

/** Multi-select, all on by default. The leading "All" chip re-selects them. */
function TournamentRow({
  tournaments,
  selectedTournamentIds,
  onToggleTournament,
  onSelectAllTournaments,
}: Pick<
  Props,
  'tournaments' | 'selectedTournamentIds' | 'onToggleTournament' | 'onSelectAllTournaments'
>) {
  const { t } = useI18n();
  const selected = new Set(selectedTournamentIds);
  return (
    <FilterChipRow
      id="referee-filter-tournament"
      label={t('organizer.refereesPage.tournamentFilterLabel')}
    >
      <FilterChip
        label={t('organizer.refereesPage.tournamentFilterAll')}
        selected={allTournamentsSelected(tournaments, selectedTournamentIds)}
        onClick={onSelectAllTournaments}
      />
      {tournaments.map((tournament) => (
        <FilterChip
          key={tournament.id}
          label={tournament.name}
          selected={selected.has(tournament.id)}
          onClick={() => onToggleTournament(tournament.id)}
        />
      ))}
    </FilterChipRow>
  );
}

export function AssignmentFilters({ days, ...rest }: Props) {
  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
      {/* The day row is hidden on a single-day event: one chip filters nothing.
          The tournament row always renders — hiding it would make the card
          change height as you click through days. */}
      {days.length > 1 && (
        <DayRow days={days} selectedDayIso={rest.selectedDayIso} onSelectDay={rest.onSelectDay} />
      )}
      <TournamentRow
        tournaments={rest.tournaments}
        selectedTournamentIds={rest.selectedTournamentIds}
        onToggleTournament={rest.onToggleTournament}
        onSelectAllTournaments={rest.onSelectAllTournaments}
      />
    </section>
  );
}
