'use client';

import { useLoginKeepAlive } from '@myclash/ui';
import { getPublicApiUrl } from '../lib/api-url';

/**
 * Renders nothing; keeps a display screen's login alive (rulings 92, 94). Each
 * display route's layout mounts it, so a baselined page does not grow.
 */
export function LoginKeepAlive() {
  useLoginKeepAlive(getPublicApiUrl());
  return null;
}
