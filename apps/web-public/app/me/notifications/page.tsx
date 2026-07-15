import { getApiUrl } from '@/lib/api-url';
import { getServerT } from '@/i18n/server-locale';
import NotificationSettingsClient from '../../notifications/NotificationSettingsClient';

export default async function PersonalNotificationsPage() {
  const t = await getServerT();
  const apiUrl = getApiUrl();

  return (
    <main className="px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 rounded-lg border border-border bg-surface p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">
            {t('publicApp.personalShell.role')}
          </p>
          <h1 className="mt-2 font-display font-bold text-2xl sm:text-3xl text-foreground">
            {t('publicApp.notifications.title')}
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted">
            {t('publicApp.notifications.description')}
          </p>
        </header>
        <NotificationSettingsClient apiUrl={apiUrl} embedded />
      </div>
    </main>
  );
}
