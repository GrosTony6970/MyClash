'use client';

import { useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import type { FollowAllSummary } from './useDirectoryGroups';

/**
 * Hub-level follow toggle. A follow is event-scoped, so this follows/unfollows a
 * global person across ALL their current/upcoming events in one tap.
 *
 * `upcomingEventCount` may be -1 ("unknown") for search results — the public
 * search endpoint carries no per-user state, so the button starts neutral and
 * settles after the first action returns the real counts.
 */
export function FollowButton({
  upcomingEventCount,
  followingEventCount,
  onFollow,
  onUnfollow,
}: {
  upcomingEventCount: number;
  followingEventCount: number;
  onFollow: () => Promise<FollowAllSummary | null>;
  onUnfollow: () => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [upcoming, setUpcoming] = useState(upcomingEventCount);
  const [following, setFollowing] = useState(followingEventCount);
  const [busy, setBusy] = useState(false);

  const known = upcoming >= 0;
  const noEvents = known && upcoming === 0;
  const isFollowing = following > 0;

  async function handleClick() {
    if (busy || noEvents) return;
    setBusy(true);
    if (isFollowing) {
      const ok = await onUnfollow();
      if (ok) setFollowing(0);
    } else {
      const summary = await onFollow();
      if (summary) {
        setUpcoming(summary.upcomingEventCount);
        setFollowing(summary.followedCount + summary.alreadyFollowingCount);
      }
    }
    setBusy(false);
  }

  const label = busy
    ? '…'
    : noEvents
      ? t('publicApp.me.people.noUpcomingEvents')
      : isFollowing
        ? t('publicApp.me.people.followingCount', { count: following })
        : t('publicApp.me.people.follow');

  const tone = isFollowing
    ? 'border-accent/60 bg-accent/10 text-accent'
    : noEvents
      ? 'border-border text-muted opacity-60'
      : 'border-border text-foreground hover:border-accent/60 hover:bg-accent/10';

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={busy || noEvents}
      aria-pressed={isFollowing}
      className={`flex-shrink-0 rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-default ${tone}`}
    >
      {label}
    </button>
  );
}
