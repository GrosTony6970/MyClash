import { t } from '@myclash/i18n';
import { getApiUrl } from '@/lib/api-url';
import { FighterProfileClient } from './FighterProfileClient';

export default function FighterProfileDashboardPage() {
  const apiUrl = getApiUrl();

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-6">
      <header className="mb-6">
        <h1 className="font-display font-bold text-2xl sm:text-3xl text-white">
          {t('publicApp.fighterProfile.profileDashboard')}
        </h1>
        <p className="mt-1 text-sm text-gray-400">
          {t('publicApp.fighterProfile.profileDashboardDescription')}
        </p>
      </header>
      <FighterProfileClient apiUrl={apiUrl} />
    </main>
  );
}
