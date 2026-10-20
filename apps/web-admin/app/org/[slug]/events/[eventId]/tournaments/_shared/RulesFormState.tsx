'use client';

import { useI18n } from '@myclash/next-i18n/client';
import type { RulesStatus } from './useEffectiveRules';

/**
 * What a rules screen shows instead of its form: while the rules are read, and when they cannot be
 * (ruling 46: no form before the read, and a failed read shows the error and a Retry, no Save).
 * The ONE owner for the settings tabs and the wizard steps. Nothing once the form is ready.
 */
export function RulesFormState({ status, onRetry }: { status: RulesStatus; onRetry: () => void }) {
  const { t } = useI18n();
  if (status === 'ready') return null;
  if (status === 'loading') {
    return (
      <p role="status" className="text-sm text-muted">
        {t('common.loading')}
      </p>
    );
  }
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger sm:flex-row sm:items-center sm:justify-between"
    >
      <span>{t('admin.orgTournaments.rulesReadFailed')}</span>
      <button
        type="button"
        onClick={onRetry}
        className="w-fit rounded-md border border-danger/30 bg-surface px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger/10"
      >
        {t('actions.retry')}
      </button>
    </div>
  );
}
