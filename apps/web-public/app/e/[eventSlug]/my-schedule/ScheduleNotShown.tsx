'use client';

import Link from 'next/link';
import { useI18n } from '@myclash/next-i18n/client';
import type { UnknownCaller } from '@/components/me/workshop-booking';

const DOOR =
  'rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-foreground transition-colors hover:border-muted';

/**
 * Why the guest schedule has no schedule to show. The server did not know the
 * caller, who is a visitor or an account (`unknownCaller`, ruling 266), or the
 * read failed.
 */
export type NotShownReason = UnknownCaller | 'failed';

const WORDS: Record<NotShownReason, { title: string; hint: string }> = {
  visitor: {
    title: 'publicApp.mySchedule.signInTitle',
    hint: 'publicApp.mySchedule.signInHint',
  },
  account: {
    title: 'publicApp.mySchedule.notOnListTitle',
    hint: 'publicApp.workshopDetail.accountNotOnRoster',
  },
  failed: {
    title: 'publicApp.mySchedule.loadFailedTitle',
    hint: 'publicApp.mySchedule.loadFailedHint',
  },
};

interface Props {
  reason: NotShownReason;
  eventSlug: string;
  onRetry: () => void;
}

/**
 * The guest schedule's screen when it has no schedule to show, which is three
 * different things. A visitor gets the doors that make this device somebody:
 * the participants list (a guest picks their name there) and the sign-in. An
 * account is signed in already and has no row at this Event: only the organiser
 * can add it, and a sign-in door would lead nowhere. A failed read gets Retry,
 * and no word about signing in, because the fighter may well be signed in on a
 * weak signal.
 */
export function ScheduleNotShown({ reason, eventSlug, onRetry }: Props) {
  const { t } = useI18n();
  return (
    <main
      id="main-content"
      className="flex min-h-screen items-center justify-center px-4 text-center"
    >
      <div>
        <p className="text-4xl mb-3">📅</p>
        <h1 className="font-display font-bold text-2xl sm:text-3xl text-foreground mb-2">
          {t(WORDS[reason].title)}
        </h1>
        <p className="text-sm text-foreground-secondary">{t(WORDS[reason].hint)}</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {reason === 'visitor' && (
            <>
              <Link href={`/e/${eventSlug}/participants`} className={DOOR}>
                {t('publicApp.workshopDetail.participantsList')}
              </Link>
              <Link href="/login" className={DOOR}>
                {t('publicApp.home.signIn')}
              </Link>
            </>
          )}
          {reason === 'failed' && (
            <button type="button" onClick={onRetry} className={DOOR}>
              {t('common.identityRetry')}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
