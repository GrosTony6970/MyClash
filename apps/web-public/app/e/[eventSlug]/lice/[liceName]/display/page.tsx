import { LiceDisplayClient } from './lice-display-client';

interface Props {
  params: Promise<{ eventSlug: string; liceName: string }>;
}

/**
 * The route segment is URL-encoded, and a lice name with a space is the norm
 * ("Lice 1"), so the raw param reads `Lice%201`. Decoding here — where the URL
 * stops being a URL and becomes data — is the only place that has to know: the
 * client re-encodes for its own fetch, and everything downstream (the label a
 * hall reads off the projector, the switcher's current-lice comparison) gets
 * the real name.
 *
 * The API masked this: `staff.controller.ts` decodes the segment a second time,
 * so a double-encoded name still resolved and only the rendered label was wrong.
 *
 * A malformed segment (a bare `%`) makes `decodeURIComponent` throw, which in a
 * server component is a 500 for what is really just a name that matches no lice.
 * Falling back to the raw value lets the lookup miss normally.
 */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export default async function LiceDisplayPage({ params }: Props) {
  const { eventSlug, liceName } = await params;
  // No apiUrl prop: LiceDisplayClient is a client component and resolves
  // the browser-reachable API URL via getServerApiUrl() itself. Passing the
  // server-resolved (docker-internal) URL would be unreachable in the
  // browser.
  return <LiceDisplayClient eventSlug={eventSlug} liceName={decodeSegment(liceName)} />;
}
