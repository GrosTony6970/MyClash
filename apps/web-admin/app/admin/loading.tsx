import { getServerT } from '@myclash/next-i18n/server';
import { Spinner } from '@myclash/ui';

/** Route-level loading state for the super-admin area. */
export default async function Loading() {
  const t = await getServerT();
  return (
    <main className="flex min-h-[50vh] items-center justify-center" aria-busy="true">
      <Spinner size="lg" className="text-muted" label={t('common.loading')} />
    </main>
  );
}
