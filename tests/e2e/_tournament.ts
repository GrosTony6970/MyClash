import { expect } from '@playwright/test';
import type { Api } from './_api';
import {
  championOf,
  createBracketTournament,
  ensurePersons,
  playDoubleElim,
  type Bracket,
  type Person,
} from './_bracket';

/**
 * A tournament played all the way to a champion, for the specs that need a
 * FINISHED tournament rather than a bracket to poke at — leagues (standings come
 * from placements), exports (results to export), compensation (matches to be
 * paid for).
 *
 * Those specs must not each re-invent "build a tournament and play it", and more
 * importantly must not each get it subtly different: a tournament that is not
 * actually decided produces an empty ranking, and every downstream assertion
 * then fails for a reason that has nothing to do with what is being tested.
 *
 * Uses double elimination in BRONZE mode with 8 fighters — 12 matches, the
 * cheapest shape that still yields a complete ranking (no grand final, the
 * winners final takes gold and silver, the last losers round is the bronze
 * match). That path is the one `09-double-elim.spec.ts` proves end to end, so
 * these specs build on verified machinery instead of a second implementation.
 */
export interface FinishedTournament {
  id: string;
  /** The bracket as it stands after play, every slot completed. */
  bracket: Bracket;
  championRegistrationId: string;
  /** registrationId → person, for name assertions on exports and standings. */
  personByRegistrationId: Map<string, Person>;
  /** The fighters registered, in seed order (index 0 is seed 1). */
  fighters: Person[];
}

const FIGHTERS = 8;

export interface PlayTournamentOptions {
  name: string;
  slug: string;
  /**
   * Fighters to register, in seed order (index 0 is seed 1). Defaults to the
   * shared `Seed NN` roster. Pass your own when the fighters themselves are
   * part of the subject — the league spec needs club affiliations, which the
   * shared roster deliberately does not have.
   */
  fighters?: Person[];
}

const defaultOptions = (): PlayTournamentOptions => ({
  name: 'DE finished',
  slug: `de-finished-${Date.now().toString(36)}`,
});

export async function playTournamentToChampion(
  api: Api,
  eventId: string,
  opts: PlayTournamentOptions = defaultOptions(),
): Promise<FinishedTournament> {
  const fighters = opts.fighters ?? (await ensurePersons(api, eventId, FIGHTERS));
  // The bracket is generated for exactly this many fighters, so a short roster
  // would produce byes (impossible in double elim) rather than a clear error.
  expect(fighters, `playTournamentToChampion needs exactly ${FIGHTERS} fighters`).toHaveLength(
    FIGHTERS,
  );

  const tournament = await createBracketTournament(api, eventId, {
    name: opts.name,
    slug: opts.slug,
    fighters,
  });

  await api.ok(
    await api.post(`tournaments/${tournament.id}/generate-bracket`, {
      data: {
        phaseType: 'double_elim',
        qualifyCount: FIGHTERS,
        secondChanceTarget: 'bronze',
        bronzeMatch: true,
      },
    }),
  );
  await api.ok(await api.post(`tournaments/${tournament.id}/populate-bracket`, { data: {} }));

  const result = await playDoubleElim(api, tournament.id);
  // Fail here, loudly, rather than let a half-played tournament produce an empty
  // ranking that the calling spec then misreports as its own subject failing.
  expect(result.stalled.length, result.stallReport).toBe(0);
  expect(result.bracket.slots.filter((s) => s.status !== 'completed')).toEqual([]);

  const championRegistrationId = championOf(result.bracket);
  expect(championRegistrationId, 'tournament finished with no champion').not.toBeNull();

  return {
    id: tournament.id,
    bracket: result.bracket,
    championRegistrationId: championRegistrationId as string,
    personByRegistrationId: tournament.personByRegistrationId,
    fighters,
  };
}
