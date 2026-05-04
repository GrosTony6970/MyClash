'use client';

import { t } from '@myclash/i18n';

export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 text-center">
      <div className="text-5xl mb-4">📡</div>
      <h1 className="text-2xl font-bold mb-2">{t('offline.title')}</h1>
      <p className="text-gray-400 text-sm max-w-xs">{t('offline.description')}</p>
      <button
        onClick={() => window.location.reload()}
        className="mt-6 bg-gray-800 hover:bg-gray-700 text-white px-6 py-2 rounded-lg text-sm transition-colors"
      >
        {t('offline.tryAgain')}
      </button>
    </main>
  );
}
