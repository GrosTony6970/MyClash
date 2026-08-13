'use client';

import Link from 'next/link';
import {
  DataTableCell,
  DataTableRow,
  SkillBadge,
  statusPillTone,
  reviewStatusSemantic,
} from '@myclash/ui';
import { localeToBcp47 } from '@myclash/time';
import { t } from '@myclash/i18n';
import { useI18n } from '@myclash/next-i18n/client';
import type { ReviewQueueItem } from '../_types';

// ── Type badge config ─────────────────────────────────────────────────────────

const TYPE_BADGE: Record<ReviewQueueItem['type'], { color: string; label: string }> = {
  deletion: { color: 'blue', label: 'Deletion' },
  exchange_edit: { color: 'purple', label: 'Exchange edit' },
  club_review: { color: 'green', label: 'Club review' },
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
  const { locale } = useI18n();
  const badge = TYPE_BADGE[item.type];
  const truncatedReason =
    item.reason && item.reason.length > 80 ? item.reason.slice(0, 80) + '…' : item.reason;
  const isBusy = busyId === item.id;

  return (
    <DataTableRow>
      {/* Type badge */}
      <DataTableCell className="whitespace-nowrap">
        <SkillBadge color={badge.color} label={badge.label} />
      </DataTableCell>

      {/* Target */}
      <DataTableCell className="max-w-[200px]">
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
      </DataTableCell>

      {/* Requester */}
      <DataTableCell className="whitespace-nowrap text-sm text-foreground-secondary">
        <p className="font-medium text-foreground-secondary">
          {item.requesterName ?? item.requesterEmail ?? t('admin.common.unknownUser')}
        </p>
        {item.requesterName && item.requesterEmail && (
          <p className="text-xs font-mono text-muted">{item.requesterEmail}</p>
        )}
      </DataTableCell>

      {/* Age */}
      <DataTableCell className="whitespace-nowrap text-sm text-muted">
        {relativeTime(item.createdAt)}
      </DataTableCell>

      {/* Reason */}
      <DataTableCell className="max-w-[180px] text-sm text-foreground-secondary">
        {truncatedReason ? (
          <span title={item.reason ?? undefined}>{truncatedReason}</span>
        ) : (
          <span className="text-muted">—</span>
        )}
      </DataTableCell>

      {/* Status */}
      <DataTableCell className="whitespace-nowrap">
        <span
          className={`${STATUS_PILL_BASE} ${statusPillTone(reviewStatusSemantic(item.status), 'light').className}`}
        >
          {statusLabel(item.status)}
        </span>
      </DataTableCell>

      {/* Actions */}
      <DataTableCell>
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
                  name:
                    item.reviewedByName ?? item.reviewedByEmail ?? t('admin.common.unknownUser'),
                  date: new Date(item.reviewedAt).toLocaleDateString(localeToBcp47(locale)),
                })}
              </p>
            ) : item.status === 'cancelled' ? (
              <p>
                {t('admin.adminRulesetsReview.cancelledOn', {
                  date: item.createdAt
                    ? new Date(item.createdAt).toLocaleDateString(localeToBcp47(locale))
                    : '—',
                })}
              </p>
            ) : (
              <p>—</p>
            )}
          </div>
        )}
      </DataTableCell>
    </DataTableRow>
  );
}
