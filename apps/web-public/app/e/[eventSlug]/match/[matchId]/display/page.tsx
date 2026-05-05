import { notFound } from 'next/navigation';
import { DisplayView } from './display-view';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

interface Props {
  params: Promise<{ matchId: string }>;
}

export default async function MatchDisplayPage({ params }: Props) {
  const { matchId } = await params;
  const [matchRes, penaltiesRes] = await Promise.all([
    fetch(`${API_URL}/api/v1/matches/${matchId}/display`, { next: { revalidate: 0 } }),
    fetch(`${API_URL}/api/v1/matches/${matchId}/penalties`, { next: { revalidate: 0 } }),
  ]);
  if (matchRes.status === 404) notFound();
  if (!matchRes.ok) throw new Error(`Failed to load display match: ${matchRes.status}`);

  return (
    <DisplayView
      apiUrl={API_URL}
      matchId={matchId}
      initialMatch={await matchRes.json()}
      initialPenalties={penaltiesRes.ok ? await penaltiesRes.json() : []}
    />
  );
}
