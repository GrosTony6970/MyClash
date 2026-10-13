'use client';

import { RouteErrorCard, type RouteErrorProps } from '@/components/RouteErrorCard';

/** Segment error page for the personal space: the shared card. */
export default function MeSegmentError(props: RouteErrorProps) {
  return <RouteErrorCard {...props} />;
}
