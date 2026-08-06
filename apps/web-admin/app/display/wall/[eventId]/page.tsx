import { LiveWall } from './LiveWall';

/**
 * The projector view of the live control room.
 *
 * Deliberately at /display/wall/{eventId} rather than under
 * /org/[slug]/events/[eventId]/live: `app/org/[slug]/layout.tsx` wraps every
 * descendant in OrganizerAdminShell (sidebar + header) and the event layout
 * adds the archived banner, so a route there cannot be chromeless. Sitting
 * under app/display inherits the full-bleed stage layout that already exists
 * for /display/[matchId] — no new layout file.
 *
 * Addressed by event id alone: there is no org slug in the URL, so the wall
 * renders no /org/{slug}/… links. It has no interactions anyway.
 */
export default async function LiveWallPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return <LiveWall eventId={eventId} />;
}
