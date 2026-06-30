import LeagueDetailClient from './LeagueDetailClient';

/** `/me/leagues/[slug]` — the league's classement, rendered inside the personal
 *  space with the signed-in fighter's row highlighted. */
export default function MeLeagueDetailPage() {
  return <LeagueDetailClient />;
}
