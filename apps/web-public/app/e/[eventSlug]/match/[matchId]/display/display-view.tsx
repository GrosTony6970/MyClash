'use client';

import { MatchScoreboard } from '@myclash/ui';
import { getApiUrl } from '@/lib/api-url';
import { supabase } from '@/lib/supabase';

const API_URL = getApiUrl();

interface Props {
  apiUrl: string;
  matchId: string;
  // initialMatch and initialPenalties are kept for API compatibility with page.tsx
  // but the shared MatchScoreboard component fetches its own data.
  initialMatch?: unknown;
  initialPenalties?: unknown;
  nextMatch?: unknown;
}

export function DisplayView({ matchId }: Props) {
  return (
    <MatchScoreboard
      matchId={matchId}
      apiBaseUrl={API_URL}
      supabaseClient={supabase}
      showNextMatch
      className="min-h-screen w-screen"
    />
  );
}
