'use client';

import { Button } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { localeToBcp47 } from '@myclash/time';
import type { QueueItem } from '@/lib/photos/photo-queue';

const STATUS_CLS = 'mt-1 text-sm text-foreground-secondary';

/**
 * What one photo's row says about it, by its state. The progress is shown, not announced: a
 * screen reader would queue every percent of every photo. Each settled state is announced once.
 */
function RowStatus({ item, percent }: { item: QueueItem; percent: Intl.NumberFormat }) {
  const { t } = useI18n();
  switch (item.state) {
    case 'waiting':
      return null;
    case 'sending':
      return (
        <div aria-hidden>
          <progress className="mt-2 h-2 w-full accent-accent" value={item.progress} max={1} />
          <p className={STATUS_CLS}>
            {t('publicApp.photoSend.sending', { percent: percent.format(item.progress) })}
          </p>
        </div>
      );
    case 'busy':
      return (
        <p role="status" className={STATUS_CLS}>
          {t('publicApp.photoSend.busy')}
        </p>
      );
    case 'sent':
      return (
        <p role="status" className="mt-1 text-sm text-foreground">
          {item.sent === 'waiting'
            ? t('publicApp.photoSend.sentWaiting')
            : t('publicApp.photoSend.sent')}
        </p>
      );
    case 'failed':
    case 'refused':
      return (
        <p role="alert" className="mt-1 text-sm text-danger">
          {item.message}
        </p>
      );
  }
}

/**
 * The photos picked, one row each, in pick order. `onRetry` is left out once the form is closed:
 * nothing more may be sent from the page then.
 */
export function PhotoQueue({
  items,
  onRetry,
  onRemove,
}: {
  items: QueueItem[];
  onRetry?: (key: number) => void;
  onRemove: (key: number) => void;
}) {
  const { t, locale } = useI18n();
  const percent = new Intl.NumberFormat(localeToBcp47(locale), {
    style: 'percent',
    maximumFractionDigits: 0,
  });
  if (items.length === 0) return null;
  return (
    <ul className="mt-6 divide-y divide-border rounded-lg border border-border bg-surface">
      {items.map((item) => (
        <li key={item.key} data-testid="photo-row" className="px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-sm font-medium text-foreground">
              {item.file.name}
            </span>
            <span className="flex shrink-0 gap-2">
              {onRetry && item.state === 'failed' && (
                <Button variant="outline" size="sm" onClick={() => onRetry(item.key)}>
                  {t('publicApp.photoSend.retry')}
                </Button>
              )}
              {(item.state === 'waiting' ||
                item.state === 'failed' ||
                item.state === 'refused') && (
                <Button variant="outline" size="sm" onClick={() => onRemove(item.key)}>
                  {t('publicApp.photoSend.remove')}
                </Button>
              )}
            </span>
          </div>
          <RowStatus item={item} percent={percent} />
        </li>
      ))}
    </ul>
  );
}
