import { t } from '@myclash/i18n';
import { getApiUrl } from '@/lib/api-url';
import NotificationSettingsClient from '../../notifications/NotificationSettingsClient';

export default function PersonalNotificationsPage() {
  const apiUrl = getApiUrl();

  return (
    <main className="px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#1d4ed8]">
            {t('publicApp.personalShell.role')}
          </p>
          <h1 className="mt-2 font-display font-bold text-2xl sm:text-3xl text-[#0f172a]">
            {t('publicApp.notifications.title')}
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {t('publicApp.notifications.description')}
          </p>
        </header>
        <div className="rounded-lg bg-[#0f172a] p-4 text-white shadow-sm sm:p-6">
          <NotificationSettingsClient apiUrl={apiUrl} embedded />
        </div>
      </div>
    </main>
  );
}
