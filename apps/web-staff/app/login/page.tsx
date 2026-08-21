'use client';

import Image from 'next/image';
import { useSyncExternalStore } from 'react';
import { LanguageSwitcher, useI18n } from '@myclash/next-i18n/client';
import { MagicLinkForm } from './MagicLinkForm';
import { StaffPinForm } from './StaffPinForm';

/**
 * The organizer hands a referee a link carrying the event (and their username):
 * `…/login?event=<slug>&u=<username>`. Read straight off `window.location` —
 * `useSearchParams` would make the React Compiler bail out of this page — via
 * useSyncExternalStore so the server snapshot is empty and hydration matches.
 * The querystring never changes without a navigation, so the subscription is a
 * no-op.
 */
const subscribeQuery = (): (() => void) => () => {};
const readQueryParam = (name: string): string =>
  new URLSearchParams(window.location.search).get(name)?.trim() ?? '';
const emptyParam = (): string => '';

/**
 * One door, two identities.
 *
 * The PIN form is for event staff — a local account scoped to one event, which
 * every event-day volunteer uses whatever their role. The magic link is for an
 * organiser who already has a MyClash account. They share nothing but this
 * page, which is why each owns its own component.
 */
export default function StaffLoginPage() {
  const { t } = useI18n();
  const linkedEvent = useSyncExternalStore(
    subscribeQuery,
    () => readQueryParam('event'),
    emptyParam,
  );
  const linkedUsername = useSyncExternalStore(
    subscribeQuery,
    () => readQueryParam('u'),
    emptyParam,
  );

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-sm">
        <div className="mb-4 flex justify-end">
          <LanguageSwitcher />
        </div>
        <div className="text-center mb-8">
          <Image
            src="/brand/Logomini_nobackground.png"
            alt={t('metadata.scoringTitle')}
            width={80}
            height={80}
            priority
            className="mx-auto mb-3 h-20 w-20"
          />
          <h1 className="text-2xl font-bold">{t('scoring.login.title')}</h1>
          <p className="text-muted text-sm mt-1">{t('scoring.login.staffAccess')}</p>
        </div>

        <StaffPinForm linkedEvent={linkedEvent} linkedUsername={linkedUsername} />
        <MagicLinkForm />
      </div>
    </main>
  );
}
