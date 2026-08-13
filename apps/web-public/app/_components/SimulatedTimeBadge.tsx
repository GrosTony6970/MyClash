'use client';

import { useNow, useRuntimeFlags } from '@myclash/ui';
import { getPublicApiUrl } from '@/lib/api-url';
import { useI18n } from '@myclash/next-i18n/client';

/**
 * Fixed badge shown only while the `time_simulation` feature flag is
 * active, so visitors and testers can see the public app is running off a
 * super-admin-shifted clock rather than real time. Reads the same
 * runtime-flags poll the maintenance banner already drives (no extra
 * network cost) and the same `useNow` clock the schedule uses, so the
 * displayed value advances in lock-step with the simulated UI.
 */
export function SimulatedTimeBadge() {
  const { t, locale } = useI18n();
  const apiUrl = getPublicApiUrl();
  const flags = useRuntimeFlags(apiUrl);
  const now = useNow(apiUrl);

  if (!flags?.timeSimulation.enabled) return null;

  const formatted = new Date(now).toLocaleString(locale === 'fr' ? 'fr-FR' : 'en-GB');

  return (
    <div
      role="status"
      className="fixed bottom-3 right-3 z-50 flex items-center gap-2 rounded-full border border-warning/40 bg-warning/15 px-3 py-1.5 text-xs font-semibold text-warning shadow-sm backdrop-blur"
    >
      <span
        className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning motion-reduce:animate-none"
        aria-hidden
      />
      {t('admin.featureFlags.timeSimulation.activeNote')}: {formatted}
    </div>
  );
}
