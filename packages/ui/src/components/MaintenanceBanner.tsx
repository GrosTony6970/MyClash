'use client';

import type { MaintenanceBannerSeverity } from '@myclash/feature-flags';
import { useRuntimeFlags } from '../hooks/useRuntimeFlags';

const SEVERITY_CLASSES: Record<MaintenanceBannerSeverity, string> = {
  info: 'bg-slate-800 text-slate-100',
  warning: 'bg-amber-500 text-amber-950',
  critical: 'bg-red-600 text-white',
};

interface MaintenanceBannerProps {
  /** API base URL — varies per app (web-admin / web-public / web-staff). */
  apiUrl: string;
}

/**
 * Top-of-page banner driven by the `maintenance_banner` feature flag.
 * Renders nothing when the flag is off or the snapshot hasn't loaded
 * yet — first paint is never blocked by waiting for the public flags
 * endpoint. Polls every 60 s via the shared runtime-flags cache.
 */
export function MaintenanceBanner({ apiUrl }: MaintenanceBannerProps) {
  const flags = useRuntimeFlags(apiUrl);
  const banner = flags?.maintenanceBanner;
  if (!banner?.enabled || !banner.message) return null;

  const severity: MaintenanceBannerSeverity = banner.severity ?? 'info';

  return (
    <div
      role="status"
      aria-live="polite"
      className={`w-full px-4 py-2 text-center text-sm font-medium ${SEVERITY_CLASSES[severity]}`}
    >
      {banner.message}
    </div>
  );
}
