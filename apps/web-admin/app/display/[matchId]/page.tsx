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
 * via TVScoreboard's `useLiveMatch`. Auto-rollover stays within
 * `/display/{nextId}` (no web-public `/e/...` hop).
 *
 * - `mirror` swaps the fighter columns for a TV facing the audience.
 *   Defaults ON, toggleable, persisted in localStorage so it survives
 *   the auto-rollover navigation.
 * - `pollMs` is a fallback refresh: this page's realtime WebSocket is
 *   cross-origin (admin.${DOMAIN} → app.${DOMAIN}) and can be blocked
 *   under self-signed `--dev-certs`; the poll hits the same-origin
 *   admin API that already serves the initial render.
 */

import { use, useEffect, useState } from 'react';
import { TVScoreboard } from '@myclash/ui';
import { t } from '@myclash/i18n';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { getPublicApiUrl } from '@/lib/api-url';

const MIRROR_STORAGE_KEY = 'myclash:display:mirror';

export default function DisplayPage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = use(params);
  const apiUrl = getPublicApiUrl();

  // Default ON (mirrored) for a TV facing the audience; read the
  // persisted choice after mount so SSR + first paint are stable.
  const [mirror, setMirror] = useState(true);
  useEffect(() => {
    // localStorage is browser-only, so the persisted choice can only be
    // read after mount — setState-in-effect is the intended pattern here.
    const stored = window.localStorage.getItem(MIRROR_STORAGE_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored !== null) setMirror(stored === 'true');
  }, []);

  function toggleMirror() {
    setMirror((prev) => {
      const next = !prev;
      window.localStorage.setItem(MIRROR_STORAGE_KEY, String(next));
      return next;
    });
  }

  return (
    <>
      {/* Subtle toggle over the cursor-none stage; cursor-auto so it's
          clickable. Small + translucent so it doesn't distract on the TV. */}
      <button
        type="button"
        onClick={toggleMirror}
        className="fixed left-3 top-3 z-50 cursor-pointer rounded-md border border-white/20 bg-black/40 px-3 py-1.5 text-xs font-semibold text-white/70 backdrop-blur hover:bg-black/60 hover:text-white"
      >
        {t('organizer.scoreboard.swapSides')}
      </button>
      <TVScoreboard
        matchId={matchId}
        apiBaseUrl={apiUrl}
        supabaseClient={getSupabaseBrowser()}
        eventSlug=""
        buildNextDisplayHref={(id) => `/display/${id}`}
        mirror={mirror}
        pollMs={1500}
      />
    </>
  );
}
