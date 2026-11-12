'use client';

import { useI18n } from '@myclash/next-i18n/client';
import type { ThankYou } from '@myclash/types';
import { Button, Spinner } from '@myclash/ui';
import { ReadFailed } from '@/components/me/ReadFailed';
import { readThanks } from '@/lib/fightbook/read-fightbook';
import { SparCard } from './SparCard';
import { usePagedList } from './use-paged-list';

function ThankCard({ thanks }: { thanks: ThankYou }) {
  const { t } = useI18n();
  const stars = String(thanks.stars);
  return (
    <SparCard
      fighter={thanks.from}
      when={thanks}
      message={thanks.text}
      note={
        <p
          role="img"
          aria-label={t('publicApp.fightBook.after.starOption', { stars })}
          className="font-semibold text-foreground"
        >
          {t('publicApp.fightBook.thanks.stars', { stars })}
        </p>
      }
    />
  );
}

/**
 * The thank-yous I received (ruling 684), newest first, 20 a page with "Show more": the paging is
 * `usePagedList`, the one owner Find uses too. Signed ones only; the API never sends an anonymous
 * review, so nothing here can name or hide a sender it was not given.
 */
export function ThanksList({ apiUrl }: { apiUrl: string }) {
  const { t } = useI18n();
  const thanks = usePagedList(
    apiUrl,
    (page, signal) => readThanks(apiUrl, page, signal),
    (item) => item.id,
  );
  return (
    <section data-thanks-list className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-foreground">
        {t('publicApp.fightBook.thanks.heading')}
      </h3>
      {thanks.items?.length === 0 ? (
        <p className="text-sm text-muted">{t('publicApp.fightBook.thanks.empty')}</p>
      ) : null}
      {thanks.items?.length ? (
        <ul className="flex flex-col gap-3">
          {thanks.items.map((item) => (
            <ThankCard key={item.id} thanks={item} />
          ))}
        </ul>
      ) : null}
      {thanks.failed ? (
        <ReadFailed title={t('publicApp.fightBook.thanks.failed')} onRetry={thanks.retry} />
      ) : null}
      {thanks.loading ? <Spinner label={t('common.loading')} /> : null}
      {thanks.more ? (
        <Button type="button" variant="outline" className="min-h-11" onClick={thanks.showMore}>
          {t('publicApp.fightBook.find.more')}
        </Button>
      ) : null}
    </section>
  );
}
