/**
 * Part of check 25 of the RLS probe (`team-tables-probe.mjs` runs it): a League takes individual
 * Tournaments only (migration 0287, rulings 729 and 981).
 *
 * Each write runs AS THE OWNER (0216 leaves no web role a write on the League tables) in a savepoint
 * rolled back, on the seed's two Leagues, its published team Tournament and its individual one, and
 * on an empty individual Tournament a case makes. A refusal is matched by the name the trigger
 * raises with, so a write refused for another reason is a failure too. Each refused case but the
 * two of the order below holds only its own fault: the empty Tournament has no entrant and no
 * phase, so `entrant_kind_is_settled` (0281) and `entrant_kind_set_before_phases` (0288), the other
 * checks of a change of kind, hold.
 * Refused: a requested or an approved link to a team Tournament, a rejected link to one approved
 * again or asked for again by the API's upsert (`INSERT … ON CONFLICT DO UPDATE`, whose BEFORE
 * INSERT trigger judges the proposed row), a live link moved to one, and the switch to team of a
 * Tournament with a requested or an approved link. Taken: a rejected and a removed link to a team
 * Tournament, a requested link to an individual one, and the switch to team of a Tournament whose
 * links are removed or rejected.
 *
 * The order of the three checks of a change of kind: AFTER triggers of one event fire in name
 * order, `entrant_kind_is_settled` < `entrant_kind_set_before_phases` < `league_link_blocks_team`,
 * and the screen names the first refusal. So a Tournament with an entrant, a phase and a live link
 * is refused for its entrants, and one with a phase and a live link for its phase.
 *
 * The race of a link and a switch needs two connections on committed rows: the cascade probe runs
 * it (`team-kind-race.mjs`).
 */

import { errorOf, OPEN, TOURNAMENT } from './match-rules-probe-kit.mjs';

// The seed's published team Tournament, its two Leagues and a requester (rls-probe-seed.sql). The
// public League already links the individual Tournament; the private one links nothing.
const TEAM_TOURNAMENT = '77777777-0000-4000-8000-00000000007a';
const PUBLIC_LEAGUE = '1eaa0000-0000-4000-8000-00000000000a';
const PRIVATE_LEAGUE = '1eaa0000-0000-4000-8000-00000000000b';
const REQUESTER = '11111111-1111-4111-8111-111111111111';
// A person of the seed's published Event, for an entrant of an empty Tournament.
const PERSON = 'b0f00000-0000-4000-8000-00000000000a';

/** A link of `league` to `tournament` with `status`; its id. */
const link = async (sp, tournament, status, league = PUBLIC_LEAGUE) =>
  (
    await sp`INSERT INTO league_tournament_links (league_id, tournament_id, status, requested_by_user_id)
             VALUES (${league}, ${tournament}, ${status}, ${REQUESTER}) RETURNING id`
  )[0].id;

/** A new individual Tournament of the published Event with no entrant; its id. */
const emptyIndividual = async (sp) =>
  (
    await sp`INSERT INTO tournaments (event_id, slug, name, status)
             VALUES (${OPEN}, 'league-probe', 'League probe', 'draft') RETURNING id`
  )[0].id;

const makeTeam = (sp, id) => sp`UPDATE tournaments SET entrant_kind = 'team' WHERE id = ${id}`;

/**
 * A new empty individual Tournament with a link of each `[status, league]`, and a Registration
 * and a Pool phase when asked, switched to team.
 */
async function switchWithLinks(sp, links, { entrant = false, phase = false } = {}) {
  const id = await emptyIndividual(sp);
  for (const [status, league] of links) await link(sp, id, status, league);
  if (entrant)
    await sp`INSERT INTO registrations (tournament_id, person_id) VALUES (${id}, ${PERSON})`;
  if (phase) await sp`INSERT INTO phases (tournament_id, type) VALUES (${id}, 'pool')`;
  await makeTeam(sp, id);
  const [{ kind }] = await sp`SELECT entrant_kind AS kind FROM tournaments WHERE id = ${id}`;
  if (kind !== 'team') throw new Error('the kind did not change');
}

const CASES = [
  {
    what: 'a requested link to a team Tournament',
    refusedBy: 'league_link_individual_only',
    write: (sp) => link(sp, TEAM_TOURNAMENT, 'requested'),
  },
  {
    what: 'an approved link to a team Tournament',
    refusedBy: 'league_link_individual_only',
    write: (sp) => link(sp, TEAM_TOURNAMENT, 'approved'),
  },
  {
    what: 'a rejected link to a team Tournament approved again',
    refusedBy: 'league_link_individual_only',
    write: async (sp) => {
      const id = await link(sp, TEAM_TOURNAMENT, 'rejected');
      await sp`UPDATE league_tournament_links SET status = 'approved' WHERE id = ${id}`;
    },
  },
  {
    what: 'a rejected link to a team Tournament asked for again by an upsert',
    refusedBy: 'league_link_individual_only',
    write: async (sp) => {
      await link(sp, TEAM_TOURNAMENT, 'rejected');
      await sp`INSERT INTO league_tournament_links (league_id, tournament_id, status, requested_by_user_id)
               VALUES (${PUBLIC_LEAGUE}, ${TEAM_TOURNAMENT}, 'requested', ${REQUESTER})
               ON CONFLICT (league_id, tournament_id) DO UPDATE SET status = EXCLUDED.status`;
    },
  },
  {
    what: 'a live link moved to a team Tournament',
    refusedBy: 'league_link_individual_only',
    write: async (sp) => {
      const id = await link(sp, await emptyIndividual(sp), 'requested');
      await sp`UPDATE league_tournament_links SET tournament_id = ${TEAM_TOURNAMENT} WHERE id = ${id}`;
    },
  },
  {
    what: 'the switch to team of a Tournament with a requested link',
    refusedBy: 'league_link_blocks_team',
    write: (sp) => switchWithLinks(sp, [['requested', PUBLIC_LEAGUE]]),
  },
  {
    what: 'the switch to team of a Tournament with an approved link',
    refusedBy: 'league_link_blocks_team',
    write: (sp) => switchWithLinks(sp, [['approved', PUBLIC_LEAGUE]]),
  },
  {
    what: 'the switch to team of a Tournament with a Registration, a phase and a requested link',
    refusedBy: 'entrant_kind_is_settled',
    write: (sp) =>
      switchWithLinks(sp, [['requested', PUBLIC_LEAGUE]], { entrant: true, phase: true }),
  },
  {
    what: 'the switch to team of a Tournament with a phase and a requested link, and no entrant',
    refusedBy: 'entrant_kind_set_before_phases',
    write: (sp) => switchWithLinks(sp, [['requested', PUBLIC_LEAGUE]], { phase: true }),
  },
  {
    what: 'a rejected link to a team Tournament',
    refusedBy: null,
    write: (sp) => link(sp, TEAM_TOURNAMENT, 'rejected'),
  },
  {
    what: 'a removed link to a team Tournament',
    refusedBy: null,
    write: (sp) => link(sp, TEAM_TOURNAMENT, 'removed'),
  },
  {
    what: 'a requested link to an individual Tournament',
    refusedBy: null,
    write: (sp) => link(sp, TOURNAMENT, 'requested', PRIVATE_LEAGUE),
  },
  {
    what: 'the switch to team of a Tournament with a removed and a rejected link',
    refusedBy: null,
    write: (sp) =>
      switchWithLinks(sp, [
        ['removed', PUBLIC_LEAGUE],
        ['rejected', PRIVATE_LEAGUE],
      ]),
  },
];

/** What is wrong, as sentences; none when all is right. */
export async function teamLeagueFailures(tx) {
  const failures = [];
  for (const { what, refusedBy, write } of CASES) {
    const error = await errorOf(tx, write);
    if (!refusedBy && error) {
      failures.push(`check 25: ${what} is refused: ${error.message}`);
    } else if (refusedBy && error?.constraint_name !== refusedBy) {
      failures.push(
        `check 25: ${what} is not refused by ${refusedBy} (${error ? error.message : 'taken'})`,
      );
    }
  }
  return failures;
}
