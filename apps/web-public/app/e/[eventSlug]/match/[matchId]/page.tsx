import { notFound } from 'next/navigation';
import { getApiUrl } from '@/lib/api-url';
import { MatchLiveView } from './match-live-view';
import {
  mapMatchRow,
  type ExchangeRow,
  type MatchPenaltyRow,
  type MatchRow,
  type MatchSummary,
} from './match-row';

const API_URL = getApiUrl();

async function fetchMatch(matchId: string): Promise<MatchRow | null> {
  const res = await fetch(`${API_URL}/api/v1/matches/${matchId}`, {
    next: { revalidate: 0 }, // always fresh — scores change constantly during an event
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch match: ${res.status}`);
  // `/matches/:id` returns the raw snake_case row — normalise to MatchRow.
  return mapMatchRow((await res.json()) as Record<string, unknown>);
}

async function fetchSummary(matchId: string): Promise<MatchSummary> {
  const res = await fetch(`${API_URL}/api/v1/matches/${matchId}/summary`, {
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    return {
      roundCode: '',
      redName: '',
      blueName: '',
      redClub: null,
      blueClub: null,
      eventTimezone: 'Europe/Paris',
      referees: [],
    };
  }
  return (await res.json()) as MatchSummary;
}

async function fetchExchanges(matchId: string): Promise<ExchangeRow[]> {
  const res = await fetch(`${API_URL}/api/v1/matches/${matchId}/exchanges`, {
    next: { revalidate: 0 },
  });
  if (!res.ok) return [];
  return (await res.json()) as ExchangeRow[];
}

async function fetchPenalties(matchId: string): Promise<MatchPenaltyRow[]> {
  const res = await fetch(`${API_URL}/api/v1/matches/${matchId}/penalties`, {
    next: { revalidate: 0 },
  });
  if (!res.ok) return [];
  return (await res.json()) as MatchPenaltyRow[];
}

interface Props {
  params: Promise<{ eventSlug: string; matchId: string }>;
}

export default async function MatchPage({ params }: Props) {
  const { matchId } = await params;

  const [match, summary, exchanges, penalties] = await Promise.all([
    fetchMatch(matchId),
    fetchSummary(matchId),
    fetchExchanges(matchId),
    fetchPenalties(matchId),
  ]);

  if (!match) notFound();

  return (
    <MatchLiveView
      matchId={matchId}
      initialMatch={match}
      initialSummary={summary}
      initialExchanges={exchanges}
      initialPenalties={penalties}
      apiUrl={API_URL}
    />
  );
}

export async function generateMetadata({ params }: Props) {
  const { matchId } = await params;
  const match = await fetchMatch(matchId);
  return {
    title: match?.matchNumberLabel
      ? `Match ${match.matchNumberLabel} · MyClash`
      : 'Match · MyClash',
  };
}
