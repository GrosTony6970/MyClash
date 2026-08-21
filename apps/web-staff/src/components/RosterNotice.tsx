'use client';

import { useI18n } from '@myclash/next-i18n/client';

/**
 * Says out loud when the event outgrew what one desk screen holds.
 *
 * Both desks put a count on every tab, and a count is a promise that the rows
 * are there to be scrolled to. When the server's ceiling cuts the roster short
 * that promise stops being true, so the screen states it rather than letting a
 * volunteer search for someone who was never sent.
 *
 * Renders nothing in the ordinary case, which is every event this product has
 * ever run.
 */
export function RosterNotice({ truncated, shown }: { truncated: boolean; shown: number }) {
  const { t } = useI18n();
  if (!truncated) return null;

  return (
    <p className="mt-3 rounded-lg border border-warning px-4 py-3 text-sm text-warning">
      {t('scoring.desk.truncated', { count: String(shown) })}
    </p>
  );
}
