'use client';
import Link from 'next/link';
import type { useI18n } from '@/i18n/I18nProvider';
import { buildMatchScoringHref, STAFF_APP_PREFIX } from '../pools/_tabs/build-scoring-href';

type T = ReturnType<typeof useI18n>['t'];

const PUBLIC_APP_URL = process.env['NEXT_PUBLIC_PUBLIC_APP_URL'] ?? 'https://app.myclash.fr';

const ACTION_CLASS =
  'rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-surface-2';

/**
 * What an organizer can do about the bout they just expanded.
 *
 * Every one of these is an EXPLICIT action, never the row's primary click:
 * following a link costs the organizer sight of every other piste, which is
 * the one thing an ops board must not do by accident.
 *
 * Note what is absent: `/scoring/lices/{liceId}`. That route is behind the
 * `mc_staff` cookie only, so an org admin following it is bounced to /login.
 * `buildScoringHref` builds exactly that URL and is deliberately never called.
 */
export function BoardRowActions({
  matchId,
  liceName,
  eventSlug,
  slug,
  eventId,
  t,
}: {
  matchId: string;
  liceName: string;
  eventSlug: string | null;
  slug: string;
  eventId: string;
  t: T;
}) {
  // Same argument shape the pools table and the bracket already pass, so the
  // pad returns here and mirrors to the same hall screen.
  const scoringHref = buildMatchScoringHref(
    STAFF_APP_PREFIX,
    matchId,
    typeof window !== 'undefined' ? window.location.href : null,
    `/display/${matchId}`,
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {scoringHref && (
        <Link href={scoringHref} className={ACTION_CLASS}>
          {t('organizer.live.actions.score')}
        </Link>
      )}
      <a href={`/display/${matchId}`} target="_blank" rel="noreferrer" className={ACTION_CLASS}>
        {t('organizer.live.actions.tv')}
      </a>
      <Link href={`/org/${slug}/events/${eventId}/matches/${matchId}`} className={ACTION_CLASS}>
        {t('organizer.live.actions.audit')}
      </Link>
      {eventSlug && (
        <a
          href={`${PUBLIC_APP_URL}/e/${eventSlug}/lice/${encodeURIComponent(liceName)}/display`}
          target="_blank"
          rel="noreferrer"
          className={ACTION_CLASS}
        >
          {t('organizer.live.actions.kiosk')}
        </a>
      )}
    </div>
  );
}
