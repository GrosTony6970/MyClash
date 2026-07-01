'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Avatar } from '@myclash/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { FollowButton } from './FollowButton';
import type { FollowAllSummary, MemberCard as MemberCardData } from './useDirectoryGroups';

function DashboardStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2">
      <p className="text-[11px] uppercase tracking-widest text-muted">{label}</p>
      <p className="mt-1 text-base font-black tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className={`h-4 w-4 transition-transform ${open ? '' : '-rotate-90'}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
    >
      <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MemberCard({
  member,
  onFollow,
  onUnfollow,
  onRemove,
}: {
  member: MemberCardData;
  onFollow: () => Promise<FollowAllSummary | null>;
  onUnfollow: () => Promise<boolean>;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const subtitle = [member.clubName, member.favoriteWeapon].filter(Boolean).join(' · ');
  const winRate = member.winRate === null ? '—' : `${member.winRate}%`;

  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <Link
          href={`/fighters/${member.slug}`}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Avatar name={member.displayName} src={member.photoUrl ?? undefined} size="md" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{member.displayName}</p>
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
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <DashboardStat label={t('publicApp.fighterProfile.matches')} value={member.matches} />
            <DashboardStat label={t('publicApp.fighterProfile.totalWins')} value={member.wins} />
            <DashboardStat
              label={t('publicApp.fighterProfile.totalLosses')}
              value={member.losses}
            />
            <DashboardStat label={t('publicApp.fighterProfile.winRate')} value={winRate} />
            <DashboardStat
              label={t('publicApp.fighterProfile.eventsAttended')}
              value={member.eventsAttended}
            />
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
