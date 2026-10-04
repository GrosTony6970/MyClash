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

import { useI18n, type Translator } from '@myclash/next-i18n/client';
import type { ReviewQueueItem } from '../_types';
import { ageOf, typeBadge } from './queue-row-copy';

// ── Status pill ───────────────────────────────────────────────────────────────

const STATUS_PILL_BASE = 'inline-block rounded-full border px-2 py-0.5 text-xs font-semibold';

// Takes the translator: this is module scope, where no hook can run, and the
// module-level `t` is permanently English.
function statusLabel(t: Translator, status: string): string {
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

// ── Props ─────────────────────────────────────────────────────────────────────

export interface QueueRowProps {
  item: ReviewQueueItem;
  busyId: string | null;
  onApprove: (item: ReviewQueueItem) => void;
  onReject: (item: ReviewQueueItem) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function QueueRow({ item, busyId, onApprove, onReject }: QueueRowProps) {
  const { locale, t } = useI18n();
  const badge = typeBadge(item);
  const truncatedReason =
    item.reason && item.reason.length > 80 ? item.reason.slice(0, 80) + '…' : item.reason;
  const isBusy = busyId === item.id;

  return (
    <DataTableRow>
      {/* Type badge */}
      <DataTableCell className="whitespace-nowrap">
        <SkillBadge color={badge.color} label={t(badge.labelKey)} />
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
        {ageOf(item.createdAt, localeToBcp47(locale))}
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
          {statusLabel(t, item.status)}
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
