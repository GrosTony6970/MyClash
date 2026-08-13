'use client';

import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useI18n } from '@myclash/next-i18n/client';
import {
  getServerSnapshot,
  getSnapshot,
  setFollowing,
  subscribe,
} from './organization-follows-store';

/**
 * Follow toggle for an organiser. Used by /o/[slug], the event header and the
 * /organisers directory.
 *
 * Reads the follow state from a shared store rather than fetching per button:
 * a directory page renders one of these per card, and one request for the whole
 * page is the point (see organization-follows-store.ts). Every surface stays in
 * sync — unfollow on a card and the header button flips too.
 *
 * The pages that host this stay cookie-free server fetches, so they remain
 * cacheable and identical for every visitor. This button is the only per-user
 * bit on any of them.
 *
 * `followerCount` is optional: /o/[slug] shows the count next to the button,
 * the event header and the directory cards do not (they have no server-rendered
 * count to start from, and a second per-card request to get one is not worth
 * it).
 */
export function FollowOrganizerButton({
  organizationId,
  slug,
  followerCount,
}: {
  organizationId: string;
  slug: string;
  followerCount?: number;
}) {
  const { t } = useI18n();
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [busy, setBusy] = useState(false);
  // Optimistic delta on top of the server-rendered count, so the number moves
  // with the button instead of waiting for a reload.
  const [delta, setDelta] = useState(0);

  const following = snapshot.ids.has(organizationId);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      const now = await setFollowing(organizationId, !following);
      if (now !== following) setDelta((d) => d + (now ? 1 : -1));
    } finally {
      setBusy(false);
    }
  }

  const count =
    followerCount === undefined ? null : (
      <span className="text-sm text-muted">
        {t('publicApp.organizer.followerCount', { count: followerCount + delta })}
      </span>
    );

  // Nothing actionable to show yet: the count (when there is one) holds the
  // space until the store answers.
  if (snapshot.status === 'loading') return count;

  if (snapshot.status === 'anonymous') {
    // A dead button would be worse than a link that explains itself.
    return (
      <div className="flex items-center gap-3">
        {count}
        <Link
          href={`/login?next=${encodeURIComponent(`/o/${slug}`)}`}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-accent/60 hover:bg-accent/10"
        >
          {t('publicApp.organizer.signInToFollow')}
        </Link>
      </div>
    );
  }

  const tone = following
    ? 'border-accent/60 bg-accent/10 text-accent'
    : 'border-border text-foreground hover:border-accent/60 hover:bg-accent/10';

  return (
    <div className="flex items-center gap-3">
      {count}
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        aria-pressed={following}
        className={`flex-shrink-0 rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-default ${tone}`}
      >
        {busy
          ? '…'
          : following
            ? t('publicApp.organizer.following')
            : t('publicApp.organizer.follow')}
      </button>
    </div>
  );
}
