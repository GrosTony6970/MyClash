import LeaguesClient from './LeaguesClient';

/** `/me/leagues` — the leagues (classement) the signed-in fighter is ranked in.
 *  The client island resolves the API URL and is locale-aware. */
export default function MeLeaguesPage() {
  return <LeaguesClient />;
}
