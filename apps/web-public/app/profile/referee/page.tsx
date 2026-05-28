import { t } from '@myclash/i18n';
import { getApiUrl } from '@/lib/api-url';
import { RefereeProfileClient } from './RefereeProfileClient';

export default function RefereeProfileDashboardPage() {
  const apiUrl = getApiUrl();

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-white">
          {t('publicApp.fighterProfile.refereeDashboard')}
        </h1>
        <p className="mt-1 text-sm text-gray-400">
          {t('publicApp.fighterProfile.refereeDashboardDescription')}
        </p>
      </header>
      <RefereeProfileClient apiUrl={apiUrl} />
    </main>
  );
}
