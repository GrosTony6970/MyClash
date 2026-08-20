'use client';

import { useI18n } from '@myclash/next-i18n/client';

/**
 * Shown by both admin shells when the `/api/v1/me` check ran out of retries.
 *
 * It exists so the give-up path leaves a trace. The shells now stay put instead
 * of redirecting to /login, which is right — the operator has not been signed
 * out and the page below still works, because its own calls carry the same
 * cookie. What they would otherwise get is a menu that is quietly missing its
 * org switcher, with nothing saying why: a branch firing in silence, which
 * CLAUDE.md names as the bug.
 *
 * `role="status"` and not `alert`: nothing is broken for the operator right now
 * and nothing needs interrupting. It is polite, and it carries the way back.
 */
export function IdentityUnverifiedBanner({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm text-warning"
    >
      <span className="min-w-0 flex-1">{t('common.identityUnverified')}</span>
      <button
        type="button"
        onClick={onRetry}
        className="shrink-0 rounded-md border border-warning/30 px-2.5 py-1 text-xs font-semibold hover:bg-warning/20"
      >
        {t('common.identityRetry')}
      </button>
    </div>
  );
}
