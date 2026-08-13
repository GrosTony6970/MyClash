'use client';

import Link from 'next/link';
import { RowActionButton, rowActionClasses } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { RulesetExportButton } from '../../../../../../src/components/rulesets/RulesetExportButton';

interface PenaltyManageActionsProps {
  row: {
    id: string;
    code: string;
    built_in: boolean;
    owner_organization_id: string | null;
    public_visibility: boolean;
    public_visibility_request_status: string | null;
    public_visibility_request_reason: string | null;
  };
  actions: { view: boolean; edit: boolean; clone: boolean; delete: boolean };
  orgId: string | null;
  slugForLink: string;
  sharingBadge: { label: string; className: string } | null;
  onSubmitShare: (id: string) => void;
  onDelete: (id: string) => void;
}

/** The per-row action buttons for the penalty Manage table, extracted to keep
 *  the page under the file-length cap. Export shows for the org's own rows;
 *  `sharingBadge` is computed by the page (it owns the sharing-status logic). */
export function PenaltyManageActions({
  row,
  actions,
  orgId,
  slugForLink,
  sharingBadge,
  onSubmitShare,
  onDelete,
}: PenaltyManageActionsProps) {
  const { t } = useI18n();
  const isOwn = !row.built_in && row.owner_organization_id === orgId;
  const editHref = `/org/${slugForLink}/rulesets/penalty/${row.id}/edit`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {sharingBadge && (
        <span
          className={`rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${sharingBadge.className}`}
          title={row.public_visibility_request_reason ?? undefined}
        >
          {sharingBadge.label}
        </span>
      )}
      {actions.view && (
        <Link href={editHref} className={rowActionClasses('neutral')}>
          {t('admin.rulesets.viewAction')}
        </Link>
      )}
      {actions.edit && (
        <Link href={editHref} className={rowActionClasses('edit')}>
          {t('admin.rulesets.shared.actions.edit')}
        </Link>
      )}
      {actions.clone && (
        <Link
          href={`/org/${slugForLink}/rulesets/penalty/new?cloneFrom=${row.id}`}
          className={rowActionClasses('neutral')}
        >
          {t('admin.rulesets.shared.actions.clone')}
        </Link>
      )}
      {isOwn && !row.public_visibility && row.public_visibility_request_status !== 'pending' && (
        <RowActionButton variant="success" onClick={() => onSubmitShare(row.id)}>
          {t('admin.rulesets.submitForReviewAction')}
        </RowActionButton>
      )}
      {isOwn && (
        <RulesetExportButton
          endpoint={`/api/v1/penalty-rulesets/${row.id}/export`}
          filename={`${row.code}.ruleset.json`}
        />
      )}
      {actions.delete && (
        <RowActionButton variant="danger" onClick={() => onDelete(row.id)}>
          {t('admin.rulesets.shared.actions.delete')}
        </RowActionButton>
      )}
    </div>
  );
}
