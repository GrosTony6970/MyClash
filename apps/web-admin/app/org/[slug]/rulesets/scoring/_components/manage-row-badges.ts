import type { TranslationValues } from '@myclash/i18n';

type Translate = (key: string, values?: TranslationValues) => string;

interface BadgeRow {
  is_system: boolean;
  owner_organization_id: string | null;
  public_visibility: boolean;
  submitted_for_review_at: string | null;
  rejected_reason: string | null;
}

/** The origin pill (built-in / mine / shared) for a Manage-tab row. */
export function rulesetSourceBadge(
  row: BadgeRow,
  orgId: string | null,
  t: Translate,
): { label: string; className: string } {
  if (row.is_system)
    return {
      label: t('admin.rulesets.shared.badges.builtin'),
      className: 'bg-success/10 text-success',
    };
  if (row.owner_organization_id === orgId)
    return { label: t('admin.rulesets.sourceMine'), className: 'bg-info/10 text-info' };
  return { label: t('admin.rulesets.sourceShared'), className: 'bg-purple-100 text-purple-800' };
}

/** The submission-lifecycle pill for the org's own row; null for others. */
export function rulesetSubmissionBadge(
  row: BadgeRow,
  orgId: string | null,
  t: Translate,
): { label: string; className: string } | null {
  if (row.is_system || row.owner_organization_id !== orgId) return null;
  if (row.public_visibility)
    return {
      label: t('admin.rulesets.submissionApproved'),
      className: 'bg-success/10 text-success',
    };
  if (row.submitted_for_review_at)
    return {
      label: t('admin.rulesets.submissionPending'),
      className: 'bg-warning/10 text-warning',
    };
  if (row.rejected_reason)
    return {
      label: t('admin.rulesets.submissionRejected'),
      className: 'bg-danger/10 text-danger',
    };
  return {
    label: t('admin.rulesets.submissionNotSubmitted'),
    className: 'bg-background text-foreground-secondary',
  };
}
