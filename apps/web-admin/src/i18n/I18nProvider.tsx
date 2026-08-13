'use client';

import { messages } from '@myclash/i18n/admin';
import { I18nProvider as SharedI18nProvider } from '@myclash/next-i18n/client';
import type { Locale } from '@myclash/i18n/runtime';
import type { ReactNode } from 'react';

/**
 * Binds the shared provider to this app's share of the dictionary — the organiser workspace and the platform console.
 *
 * This file exists because the surface import must happen in a CLIENT module.
 * Passing `messages` down from the server `layout.tsx` instead would serialise
 * the whole surface into the RSC payload on every navigation, uncacheable, which
 * is worse than the problem the split solves.
 *
 * It is the one part of the locale layer that legitimately differs per app, so
 * it is the one part that did not move into @myclash/next-i18n.
 */
export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return (
    <SharedI18nProvider locale={locale} messages={messages}>
      {children}
    </SharedI18nProvider>
  );
}
