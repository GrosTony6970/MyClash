import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { getServerApiUrl } from '@/lib/api-url';
import { displayPageGate, loginCookieHeader } from '@/lib/login-cookie';
import { DisplayView } from './display-view';

const API_URL = getServerApiUrl();

interface Props {
  params: Promise<{ eventSlug: string; matchId: string }>;
}

export default async function MatchDisplayPage({ params }: Props) {
  const { eventSlug, matchId } = await params;
  // Sanity-check that the match exists server-side so we render a
  // proper 404 instead of letting the client fail on a missing
  // payload. The client (TVScoreboard) re-fetches on mount via the
  // useLiveMatch hook + Supabase subscriptions; the server fetch
  // here is purely for the existence gate. It sends the viewer's login: the
  // rollover lands here, and a hidden bout 404s without one. A viewer whose
  // login lapsed but can be renewed gets the page anyway: its keep-alive renews
  // the login and the scoreboard reads again (rulings 92, 94).
  const jar = await cookies();
  const matchRes = await fetch(`${API_URL}/api/v1/matches/${matchId}/display`, {
    next: { revalidate: 0 },
    headers: loginCookieHeader(jar),
  });
  const gate = displayPageGate(matchRes.status, jar);
  if (gate === 'not-found') notFound();
  if (gate === 'error') throw new Error(`Failed to load display match: ${matchRes.status}`);

  return <DisplayView matchId={matchId} eventSlug={eventSlug} />;
}
