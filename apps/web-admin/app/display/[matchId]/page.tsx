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
 */

import { use } from 'react';
import { TVScoreboard } from '@myclash/ui';
import { getSupabaseBrowser } from '@/lib/supabase-browser';

export default function DisplayPage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = use(params);
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  return (
    <TVScoreboard
      matchId={matchId}
      apiBaseUrl={apiUrl}
      supabaseClient={getSupabaseBrowser()}
      eventSlug=""
      buildNextDisplayHref={(id) => `/display/${id}`}
    />
  );
}
