/**
 * archive-swiss-entrants.ts — the columns a Swiss entrant of an archive made before migrations
 * 0243 and 0244 lacks.
 *
 * Since 0243 a withdrawn entrant says who withdrew them (`swiss_entrants.withdrawn_by`: the
 * organiser's hand, or their status), and a CHECK ties it to `withdrawn_at_round`. An older archive
 * carries the round alone, which that CHECK refuses on restore. Every withdrawal before 0243 was
 * the organiser's (the Withdraw door was its one writer), so the kind is 'hand' when the round is
 * set. Since 0244 an entrant put back carries the rounds they missed (`missed_rounds`); nobody
 * could be put back before it, so none. A row that carries a key keeps its own.
 */
import type { ArchiveRow, ArchiveTables } from './archive.types';

export function withSwissWithdrawalKind(
  data: Pick<ArchiveTables, 'swissEntrants'>,
): Pick<ArchiveTables, 'swissEntrants'> {
  return {
    swissEntrants: data.swissEntrants.map((row): ArchiveRow => ({
      ...row,
      withdrawn_by: Object.hasOwn(row, 'withdrawn_by')
        ? row['withdrawn_by']
        : row['withdrawn_at_round'] == null
          ? null
          : 'hand',
      missed_rounds: Object.hasOwn(row, 'missed_rounds') ? row['missed_rounds'] : [],
    })),
  };
}
