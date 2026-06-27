'use client';

import Link from 'next/link';
import { SkillBadge, statusPillTone, reviewStatusSemantic } from '@myclash/ui';
import { t } from '@myclash/i18n';
import type { ReviewQueueItem } from '../_types';

// ── Type badge config ─────────────────────────────────────────────────────────

const TYPE_BADGE: Record<ReviewQueueItem['type'], { color: string; label: string }> = {
  deletion: { color: 'blue', label: 'Deletion' },
  exchange_edit: { color: 'purple', label: 'Exchange edit' },
  club_review: { color: 'green', label: 'Club review' },
  ruleset_submission: { color: 'amber', label: 'Ruleset' },
  league_tournament_request: { color: 'red', label: 'League request' },
  league_membership_request: { color: 'red', label: 'League join request' },
};

// ── Status pill ───────────────────────────────────────────────────────────────

const STATUS_PILL_BASE = 'inline-block rounded-full border px-2 py-0.5 text-xs font-semibold';

function statusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return t('admin.reviewQueue.statusPending');
    case 'approved':
      return t('admin.reviewQueue.statusApproved');
    case 'rejected':
      return t('admin.reviewQueue.statusRejected');
    default:
      return status;
  }
}

// ── Relative time ─────────────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface QueueRowProps {
  item: ReviewQueueItem;
  busyId: string | null;
  onApprove: (item: ReviewQueueItem) => void;
  onReject: (item: ReviewQueueItem) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function QueueRow({ item, busyId, onApprove, onReject }: QueueRowProps) {
  const badge = TYPE_BADGE[item.type];
  const truncatedReason =
    item.reason && item.reason.length > 80 ? item.reason.slice(0, 80) + '…' : item.reason;
  const isBusy = busyId === item.id;

  return (
    <tr className="border-b border-border hover:bg-background align-top">
      {/* Type badge */}
      <td className="py-3 pr-4 whitespace-nowrap">
        <SkillBadge color={badge.color} label={badge.label} />
      </td>

      {/* Target */}
      <td className="py-3 pr-4 max-w-[200px]">
        {item.targetHref ? (
          <Link
            href={item.targetHref}
            className="text-sm text-accent underline hover:text-accent-hover break-words"
          >
            {item.targetLabel}
          </Link>
        ) : (
          <span className="text-sm text-foreground-secondary break-words">{item.targetLabel}</span>
        )}
      </td>

      {/* Requester */}
      <td className="py-3 pr-4 whitespace-nowrap text-sm text-foreground-secondary">
        <p className="font-medium text-foreground-secondary">{item.requesterName}</p>
        {item.requesterEmail && (
          <p className="text-xs font-mono text-muted">{item.requesterEmail}</p>
        )}
      </td>

      {/* Age */}
      <td className="py-3 pr-4 whitespace-nowrap text-sm text-muted">
        {relativeTime(item.createdAt)}
      </td>

      {/* Reason */}
      <td className="py-3 pr-4 max-w-[180px] text-sm text-foreground-secondary">
        {truncatedReason ? (
          <span title={item.reason ?? undefined}>{truncatedReason}</span>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>

      {/* Status */}
      <td className="py-3 pr-4 whitespace-nowrap">
        <span
          className={`${STATUS_PILL_BASE} ${statusPillTone(reviewStatusSemantic(item.status), 'light').className}`}
        >
          {statusLabel(item.status)}
        </span>
      </td>

      {/* Actions */}
      <td className="py-3">
        {item.status === 'pending' ? (
          <div className="flex gap-2">
            <button
              onClick={() => onApprove(item)}
              disabled={isBusy}
              className="rounded border border-success/30 bg-success/10 px-3 py-1 text-xs font-semibold text-success hover:bg-success/20 disabled:opacity-50"
            >
              {t('admin.reviewQueue.approve')}
            </button>
            <button
              onClick={() => onReject(item)}
              disabled={isBusy}
              className="rounded border border-danger/30 bg-danger/10 px-3 py-1 text-xs font-semibold text-danger hover:bg-danger/20 disabled:opacity-50"
            >
              {t('admin.reviewQueue.reject')}
            </button>
          </div>
        ) : (
          <div className="text-xs text-muted">
            {item.reviewedAt && item.reviewedByUserId ? (
              <p>
                {t('admin.reviewQueue.reviewedByOn', {
                  name: item.reviewedByName ?? item.reviewedByUserId,
                  date: new Date(item.reviewedAt).toLocaleDateString('fr-FR'),
                })}
              </p>
            ) : item.status === 'cancelled' ? (
              <p>
                Cancelled on{' '}
                {item.createdAt ? new Date(item.createdAt).toLocaleDateString('fr-FR') : '—'}
              </p>
            ) : (
              <p>—</p>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}
