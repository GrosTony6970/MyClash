import { t } from '@myclash/i18n';
import { Spinner } from '@myclash/ui';

/** Route-level loading state for the super-admin area. */
export default function Loading() {
  return (
    <main className="flex min-h-[50vh] items-center justify-center" aria-busy="true">
      <Spinner size="lg" className="text-muted" label={t('common.loading')} />
    </main>
  );
}
