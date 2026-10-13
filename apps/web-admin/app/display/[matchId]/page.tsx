'use client';

/**
 * External-display scoreboard — the polished `TVScoreboard` on a
 * chromeless dark stage, opened as a sized popup window from the
 * scoring pad's "↗ External display" button. Lives at `/display/[id]`
 * (outside the org shell) so there's no admin sidebar/header.
 *
 * Same-origin admin route → the admin session cookie works, so this
 * displays in-progress matches on unpublished events. Reads live state
 * over the public `/matches/:id/{display,penalties,clock}` endpoints
 * via TVScoreboard's `useLiveMatch`. When a bout is over the popup goes
 * to `/display/{nextId}` by the router, with no page load.
 *
 * - `mirror` swaps the fighter columns for a TV facing the audience.
 *   Defaults ON, toggleable, kept by `useDisplayMirror` (the one owner,
 *   shared with the public piste TV).
 * - `pollMs` is a fallback refresh: this page's realtime WebSocket is
 *   cross-origin (admin.${DOMAIN} → app.${DOMAIN}) and can be blocked
 *   under self-signed `--dev-certs`; the poll hits the same-origin
 *   admin API that already serves the initial render.
 */

import { useI18n } from '@myclash/next-i18n/client';
import { use, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { TVScoreboard, useDisplayMirror, useFullscreen } from '@myclash/ui';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { getPublicApiUrl } from '@/lib/api-url';

const STAGE_TOGGLE =
  'cursor-pointer rounded-md border border-white/20 bg-black/40 px-3 py-1.5 text-xs font-semibold text-white/70 backdrop-blur hover:bg-black/60 hover:text-white';

export default function DisplayPage({ params }: { params: Promise<{ matchId: string }> }) {
  const { t } = useI18n();

  const { matchId } = use(params);
  const apiUrl = getPublicApiUrl();

  // Default ON (mirrored) for a TV facing the audience.
  const [mirror, toggleMirror] = useDisplayMirror(true);

  // The next bout, by the router: a page that is loaded leaves fullscreen.
  const router = useRouter();
  const toNextBout = useCallback((id: string) => router.replace(`/display/${id}`), [router]);

  // It holds from bout to bout, because the popup loads no page between them.
  const fullscreen = useFullscreen();

  return (
    <>
      {/* Subtle toggles over the cursor-none stage; cursor-pointer so they're
          clickable. Small + translucent so they don't distract on the TV. */}
      <div className="fixed left-3 top-3 z-50 flex gap-2">
        <button type="button" onClick={toggleMirror} className={STAGE_TOGGLE}>
          {t('scoring.scoreboard.swapSides')}
        </button>
        {fullscreen.supported && (
          <button type="button" onClick={fullscreen.toggle} className={STAGE_TOGGLE}>
            {t(
              fullscreen.active
                ? 'scoring.scoreboard.exitFullscreen'
                : 'scoring.scoreboard.fullscreen',
            )}
          </button>
        )}
      </div>
      <TVScoreboard
        // A new bout is a new mount: nothing of the bout before it is left.
        key={matchId}
        t={t}
        matchId={matchId}
        apiBaseUrl={apiUrl}
        supabaseClient={getSupabaseBrowser()}
        onBoutOver={toNextBout}
        mirror={mirror}
        pollMs={1500}
      />
    </>
  );
}
