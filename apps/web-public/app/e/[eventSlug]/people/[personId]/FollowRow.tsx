'use client';

import type { ReactNode } from 'react';
import { useI18n } from '@myclash/next-i18n/client';

/**
 * The person page's Follow button, or the sentence that replaces it when the person prefers not to
 * be followed. `children` ("Ask to spar", when shown) sits beside Follow, or under the sentence.
 */
export function FollowRow(props: {
  allowBeingFollowed: boolean;
  following: boolean;
  busy: boolean;
  onFollow: () => void;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const { following } = props;
  if (!props.allowBeingFollowed) {
    return (
      <div className="flex flex-shrink-0 flex-col items-end gap-2">
        <p className="text-xs text-muted max-w-[120px] text-right">
          {t('publicApp.following.prefersNotFollowed')}
        </p>
        {props.children}
      </div>
    );
  }
  return (
    // Shrinks, so the two buttons wrap on a phone: a non-shrinking box never wraps.
    <div className="flex flex-wrap items-center justify-end gap-2">
      <button
        onClick={props.onFollow}
        disabled={props.busy}
        className={[
          'flex-shrink-0 px-4 py-2 rounded-xl font-semibold text-sm transition-colors disabled:opacity-50',
          following
            ? 'bg-surface border border-border text-foreground-secondary hover:border-danger hover:text-danger'
            : 'text-white',
        ].join(' ')}
        style={!following ? { backgroundColor: 'var(--color-accent)' } : {}}
      >
        {following
          ? t('publicApp.following.followingButton')
          : t('publicApp.following.followButton')}
      </button>
      {props.children}
    </div>
  );
}
