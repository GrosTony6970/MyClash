'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { TVScoreboard } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { getPublicApiUrl } from '@/lib/api-url';
import { supabase } from '@/lib/supabase';
import { boutDisplayHref } from './display-href';

const API_URL = getPublicApiUrl();

interface Props {
  matchId: string;
  eventSlug: string;
  /**
   * What the screen does when the bout is over. Default: it goes to the next
   * bout's own address.
   */
  onBoutOver?: (nextMatchId: string) => void;
  /** Blue on the left, for a screen that faces the public. */
  mirror?: boolean;
}

/**
 * Public TV / projection display. Renders the chromeless three-column
 * scoreboard, which moves on to the next match 5 seconds after the
 * current one ends, without loading a page.
 *
 * Layout decisions live in `<TVScoreboard>`. This wrapper sets the
 * fullscreen surface + cursor hide so a forgotten mouse doesn't show
 * on the projection.
 */
export function DisplayView({ matchId, eventSlug, onBoutOver, mirror }: Props) {
  const { t } = useI18n();
  const router = useRouter();
  const toNextBout = useCallback(
    (nextMatchId: string) => router.replace(boutDisplayHref(eventSlug, nextMatchId)),
    [router, eventSlug],
  );

  return (
    <div className="min-h-screen w-screen overflow-hidden bg-stage cursor-none">
      <TVScoreboard
        t={t}
        matchId={matchId}
        apiBaseUrl={API_URL}
        supabaseClient={supabase}
        onBoutOver={onBoutOver ?? toNextBout}
        mirror={mirror}
        // This screen runs unattended on a projector for a whole day, so it
        // cannot depend on the websocket alone: when the channel failed to
        // join, the board silently froze mid-bout and someone had to walk over
        // and press F5.
        //
        // Only a FALLBACK now — it runs while the channel cannot carry the bout
        // (down, or a hidden bout). It used to run unconditionally at 2s, which is how a
        // websocket that had been 403-ing since Kong was dropped went unnoticed:
        // the board looked live because it was being repainted 30 times a minute.
        // With realtime carrying the updates, 10s is only ever the degraded
        // cadence.
        pollMs={10_000}
      />
    </div>
  );
}
