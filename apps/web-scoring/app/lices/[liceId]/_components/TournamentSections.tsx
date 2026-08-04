'use client';

import type { LiceMatch } from '../../../../src/components/lice-match-types';
import { groupLiceMatchesByTournament } from '../../../../src/components/lice-tournament-context';
import { BracketDisclosure } from './BracketDisclosure';
import { PoolsDisclosure } from './PoolsDisclosure';

/**
 * Pool + bracket context, one block per tournament running on this piste.
 *
 * Tournaments the piste never touches are omitted: an operator scrolling past
 * a draw they will not score is noise. Within a tournament, everything is
 * shown in full and this lice's part of it is highlighted.
 */
export function TournamentSections({
  matches,
  apiUrl,
  liceId,
}: {
  matches: LiceMatch[];
  apiUrl: string;
  liceId: string;
}) {
  const tournaments = groupLiceMatchesByTournament(matches);
  if (tournaments.length === 0) return null;

  return (
    <div className="mt-6 flex flex-col gap-6">
      {tournaments.map((tournament) => {
        // Any match of this tournament carries its config + weapon.
        const sample = matches.find((m) => m.tournamentId === tournament.tournamentId);
        return (
          <section key={tournament.tournamentId} className="flex flex-col gap-2">
            {tournament.tournamentName && (
              <h2 className="text-xs font-bold uppercase tracking-widest text-muted">
                {tournament.tournamentName}
              </h2>
            )}
            {tournament.hasPools && (
              <PoolsDisclosure
                apiUrl={apiUrl}
                liceId={liceId}
                tournamentId={tournament.tournamentId}
              />
            )}
            {tournament.hasBracket && (
              <BracketDisclosure
                apiUrl={apiUrl}
                liceId={liceId}
                tournamentId={tournament.tournamentId}
                scoringConfig={sample?.scoringConfig ?? null}
                weapon={null}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}
