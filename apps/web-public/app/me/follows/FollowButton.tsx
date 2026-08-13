'use client';

import { useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import type { FollowAllSummary } from './useDirectoryGroups';

/**
 * Hub-level follow toggle. A follow is now persistent at the global-person
 * level (it no longer requires an upcoming event), so the button is driven by a
 * simple boolean and is always actionable.
 */
export function FollowButton({
  following: initialFollowing,
  onFollow,
  onUnfollow,
}: {
  following: boolean;
  onFollow: () => Promise<FollowAllSummary | null>;
  onUnfollow: () => Promise<boolean>;
}) {
  const { t } = useI18n();
  // Local override wins once the user toggles; until then we follow the prop, so
  // context arriving after mount (Search fetches it post-render) is reflected
  // without a state-sync effect.
  const [override, setOverride] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const following = override ?? initialFollowing;

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    if (following) {
      const ok = await onUnfollow();
      if (ok) setOverride(false);
    } else {
      const summary = await onFollow();
      if (summary) setOverride(true);
    }
    setBusy(false);
  }

  const label = busy
    ? '…'
    : following
      ? t('publicApp.me.people.following')
      : t('publicApp.me.people.follow');

  const tone = following
    ? 'border-accent/60 bg-accent/10 text-accent'
    : 'border-border text-foreground hover:border-accent/60 hover:bg-accent/10';

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={busy}
      aria-pressed={following}
      className={`flex-shrink-0 rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-default ${tone}`}
    >
      {label}
    </button>
  );
}
