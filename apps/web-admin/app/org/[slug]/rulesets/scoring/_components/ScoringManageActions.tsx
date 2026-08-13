'use client';

import Link from 'next/link';
import { RowActionButton, rowActionClasses } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { RulesetExportButton } from '../../../../../../src/components/rulesets/RulesetExportButton';

interface ScoringManageActionsProps {
  row: { id: string; code: string; is_system: boolean; base_code: string | null };
  actions: { view: boolean; edit: boolean; clone: boolean; delete: boolean };
  isMine: boolean;
  canSubmit: boolean;
  orgId: string | null;
  slugForLink: string;
  onSubmit: (id: string) => void;
  onDelete: (id: string) => void;
}

/** The per-row action buttons for the scoring Manage table, extracted to keep
 *  the page under the file-length cap. Export shows for the org's own rows. */
export function ScoringManageActions({
  row,
  actions,
  isMine,
  canSubmit,
  orgId,
  slugForLink,
  onSubmit,
  onDelete,
}: ScoringManageActionsProps) {
  const { t } = useI18n();
  const editHref = `/org/${slugForLink}/rulesets/scoring/${row.id}/edit`;
  return (
    <div className="flex flex-wrap gap-2">
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
          href={`/org/${slugForLink}/rulesets/scoring/new?cloneFrom=${row.id}`}
          className={rowActionClasses('neutral')}
        >
          {t('admin.rulesets.shared.actions.clone')}
        </Link>
      )}
      {canSubmit && (
        <RowActionButton variant="success" onClick={() => onSubmit(row.id)}>
          {t('admin.rulesets.submitForReviewAction')}
        </RowActionButton>
      )}
      {isMine && !row.is_system && !row.base_code && orgId && (
        <RulesetExportButton
          endpoint={`/api/v1/organizations/${orgId}/custom-rulesets/${row.id}/export`}
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
