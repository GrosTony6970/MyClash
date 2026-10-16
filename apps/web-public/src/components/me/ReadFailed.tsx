'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { Button } from '@myclash/ui';

/**
 * A read of the personal space that failed, said, with the way to read again. ONE notice for
 * the Schedule tab, the Event overview and the Workshops page: the two last said nothing, and
 * showed an empty day or a free seat as if the read had worked.
 */
export function ReadFailed({ title, onRetry }: { title: string; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div role="alert" className="rounded-xl border border-border bg-surface p-4 text-sm">
      <p className="font-semibold text-foreground">{title}</p>
      <Button type="button" variant="outline" onClick={onRetry} className="mt-3 min-h-11">
        {t('common.identityRetry')}
      </Button>
    </div>
  );
}
