'use client';

import { RouteErrorCard, type RouteErrorProps } from '@/components/RouteErrorCard';

/** Segment error page for the public Event pages: the shared card. */
export default function EventSegmentError(props: RouteErrorProps) {
  return <RouteErrorCard {...props} />;
}
