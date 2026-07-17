import type { ReactNode } from 'react';

/**
 * Full-bleed display layout — deliberately OUTSIDE `org/[slug]` so it
 * does NOT inherit `OrganizerAdminShell` (no sidebar, no top header).
 * Hosts the external-display scoreboard popup
 * (`/display/[matchId]`), which renders the polished `TVScoreboard`
 * on a chromeless dark stage and is meant to be thrown onto a
 * projector.
 */
export default function DisplayLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen w-screen overflow-hidden bg-stage cursor-none">{children}</div>
  );
}
