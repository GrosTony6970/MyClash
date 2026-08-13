'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Avatar, formatCountryName } from '@myclash/ui';
import { FighterStatsPanel } from '@/components/fighter/FighterStatsPanel';
import { flagEmoji } from '@/lib/flag';
import { useI18n } from '@myclash/next-i18n/client';
import { Chevron } from './Chevron';
import { FollowButton } from './FollowButton';
import { useMemberDetails } from './useMemberDetails';
import { usePersistedOpen } from './usePersistedOpen';
import type { FollowAllSummary, MemberCard as MemberCardData } from './useDirectoryGroups';

export function MemberCard({
  apiUrl,
  member,
  onFollow,
  onUnfollow,
  onRemove,
}: {
  apiUrl: string;
  member: MemberCardData;
  onFollow: () => Promise<FollowAllSummary | null>;
  onUnfollow: () => Promise<boolean>;
  onRemove: () => void;
}) {
  const { t, locale } = useI18n();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [expanded, setExpanded] = usePersistedOpen(
    `myclash:member-open:${member.globalPersonId}`,
    false,
  );
  // Warm the fetch on hover/focus so expanding is instant (no load flash).
  const [warm, setWarm] = useState(false);
  const { details, error, reload } = useMemberDetails(apiUrl, member.slug, expanded || warm);

  const subtitle = [member.clubName, member.favoriteWeapon].filter(Boolean).join(' · ');
  const flag = flagEmoji(member.countryCode);
  const countryName = member.countryCode ? formatCountryName(member.countryCode, locale) : null;

  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-sm">
      <div
        className="flex items-center gap-3"
        onMouseEnter={() => setWarm(true)}
        onFocus={() => setWarm(true)}
      >
        <Link
          href={`/fighters/${member.slug}`}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Avatar name={member.displayName} src={member.photoUrl ?? undefined} size="md" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {flag && (
                <span aria-hidden className="mr-1.5">
                  {flag}
                </span>
              )}
              {member.displayName}
              {countryName && <span className="sr-only"> · {countryName}</span>}
            </p>
            {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
          </div>
        </Link>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={t(expanded ? 'publicApp.me.groups.collapse' : 'publicApp.me.groups.expand', {
            name: member.displayName,
          })}
          className="flex-shrink-0 rounded-md border border-border p-1.5 text-muted hover:bg-foreground/5"
        >
          <Chevron open={expanded} />
        </button>
      </div>

      {expanded && (
        <>
          <div className="mt-3">
            {details ? (
              <FighterStatsPanel
                fighter={details.fighter}
                career={details.career}
                refereeStats={details.refereeStats}
              />
            ) : error ? (
              <button
                type="button"
                onClick={reload}
                className="text-sm text-danger underline-offset-2 hover:underline"
              >
                {t('common.error')}
              </button>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-hidden>
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-14 animate-pulse rounded-lg border border-border bg-background"
                  />
                ))}
              </div>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
            <FollowButton
              following={member.followingEventCount > 0}
              onFollow={onFollow}
              onUnfollow={onUnfollow}
            />
            {confirmRemove ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onRemove}
                  className="rounded-md border border-danger/60 bg-danger/10 px-3 py-1.5 text-xs font-semibold text-danger"
                >
                  {t('publicApp.me.groups.removeConfirm')}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmRemove(false)}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-muted"
                >
                  {t('publicApp.me.groups.cancel')}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmRemove(true)}
                aria-label={t('publicApp.me.groups.removeMember', { name: member.displayName })}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:border-danger/60 hover:bg-danger/10"
              >
                {t('publicApp.me.groups.remove')}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
