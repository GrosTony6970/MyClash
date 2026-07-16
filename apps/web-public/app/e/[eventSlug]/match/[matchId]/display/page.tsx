import { notFound } from 'next/navigation';
import { getServerApiUrl } from '@/lib/api-url';
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
  // here is purely for the existence gate.
  const matchRes = await fetch(`${API_URL}/api/v1/matches/${matchId}/display`, {
    next: { revalidate: 0 },
  });
  if (matchRes.status === 404) notFound();
  if (!matchRes.ok) throw new Error(`Failed to load display match: ${matchRes.status}`);

  return <DisplayView matchId={matchId} eventSlug={eventSlug} />;
}
