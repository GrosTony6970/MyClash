'use client';

import { SimulatedTimeBadge as Badge } from '@myclash/ui';
// The Luxon-free entry point: this module is in the root layout, on every page.
import { localeToBcp47 } from '@myclash/time/locale';
import { useI18n } from '@myclash/next-i18n/client';
import { getPublicApiUrl } from '@/lib/api-url';

/**
 * Binds the shared badge to this app: the root layout is a server component
 * and cannot hand `t` across, so this client module reads it here.
 */
export function SimulatedTimeBadge() {
  const { t, locale } = useI18n();
  return <Badge apiUrl={getPublicApiUrl()} t={t} bcp47Locale={localeToBcp47(locale)} />;
}
