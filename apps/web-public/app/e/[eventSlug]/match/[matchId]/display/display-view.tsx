'use client';

import { TVScoreboard } from '@myclash/ui';
import { getApiUrl } from '@/lib/api-url';
import { supabase } from '@/lib/supabase';

const API_URL = getApiUrl();

interface Props {
  matchId: string;
  eventSlug: string;
}

/**
 * Public TV / projection display. Renders the chromeless three-column
 * scoreboard with auto-rollover to the next match 5 seconds after the
 * current one ends.
 *
 * Layout decisions live in `<TVScoreboard>`. This wrapper sets the
 * fullscreen surface + cursor hide so a forgotten mouse doesn't show
 * on the projection.
 */
export function DisplayView({ matchId, eventSlug }: Props) {
  return (
    <div className="min-h-screen w-screen overflow-hidden bg-gray-950 cursor-none">
      <TVScoreboard
        matchId={matchId}
        apiBaseUrl={API_URL}
        supabaseClient={supabase}
        eventSlug={eventSlug}
      />
    </div>
  );
}
