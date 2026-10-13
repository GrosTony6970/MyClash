'use client';

import { RouteErrorCard, type RouteErrorProps } from '@/components/RouteErrorCard';

/**
 * Segment error page for the public bout page: the shared card. Its own
 * segment, so a failed scoreboard keeps the Event's shell around it.
 */
export default function MatchError(props: RouteErrorProps) {
  return <RouteErrorCard {...props} />;
}
