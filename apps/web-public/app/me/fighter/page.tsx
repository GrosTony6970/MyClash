import { t } from '@myclash/i18n';
import { getApiUrl } from '@/lib/api-url';
import { FighterProfileClient } from '../../profile/fighter/FighterProfileClient';

export default function PersonalFighterPage() {
  const apiUrl = getApiUrl();

  return (
    <main className="px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#1d4ed8]">
            {t('publicApp.personalShell.role')}
          </p>
          <h1 className="mt-2 font-display font-bold text-2xl sm:text-3xl text-[#0f172a]">
            {t('publicApp.fighterProfile.profileDashboard')}
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {t('publicApp.fighterProfile.profileDashboardDescription')}
          </p>
        </header>
        <FighterProfileClient apiUrl={apiUrl} />
      </div>
    </main>
  );
}
