'use client';

import { useLoginKeepAlive } from '@myclash/ui';
import { getPublicApiUrl } from '@/lib/api-url';

/**
 * Renders nothing; keeps a display screen's login alive (rulings 92, 94). The
 * display layout mounts it for the projector popup and the live wall.
 */
export function LoginKeepAlive() {
  useLoginKeepAlive(getPublicApiUrl());
  return null;
}
