'use client';

import { TVScoreboard } from '@myclash/ui';
import { getPublicApiUrl } from '@/lib/api-url';
import { supabase } from '@/lib/supabase';

const API_URL = getPublicApiUrl();

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
    <div className="min-h-screen w-screen overflow-hidden bg-stage cursor-none">
      <TVScoreboard
        matchId={matchId}
        apiBaseUrl={API_URL}
        supabaseClient={supabase}
        eventSlug={eventSlug}
        // This screen runs unattended on a projector for a whole day, so it
        // cannot depend on the websocket alone: when the channel failed to
        // join, the board silently froze mid-bout and someone had to walk over
        // and press F5. Every other live surface already polls (admin display
        // 1.5s, control room 7s, piste screen 20s) — this was the one that
        // didn't. 2s is well inside "the audience never notices".
        pollMs={2000}
      />
    </div>
  );
}
