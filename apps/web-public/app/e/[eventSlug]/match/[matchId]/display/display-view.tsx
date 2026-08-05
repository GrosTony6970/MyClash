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
        // and press F5.
        //
        // Only a FALLBACK now — it runs while the channel is down and stops on
        // SUBSCRIBED. It used to run unconditionally at 2s, which is how a
        // websocket that had been 403-ing since Kong was dropped went unnoticed:
        // the board looked live because it was being repainted 30 times a minute.
        // With realtime carrying the updates, 10s is only ever the degraded
        // cadence.
        pollMs={10_000}
      />
    </div>
  );
}
