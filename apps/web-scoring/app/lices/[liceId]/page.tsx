'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MatchView, NoMatchView, type MatchInfo } from '../../../src/components/MatchView';
import { useI18n } from '../../../src/i18n/I18nProvider';

interface Props {
  params: Promise<{ liceId: string }>;
}

export default function LiceMatchPage({ params }: Props) {
  const router = useRouter();
  const { t } = useI18n();
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [liceId, setLiceId] = useState<string | null>(null);
  const [currentMatch, setCurrentMatch] = useState<MatchInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  // Initialize from browser API synchronously — avoids a flash of wrong state
  const [networkStatus, setNetworkStatus] = useState<'online' | 'offline'>(
    typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'online',
  );

  // Resolve params
  useEffect(() => {
    void params.then(({ liceId: id }) => setLiceId(id));
  }, [params]);

  // Network status monitoring — only subscribe to changes, initial value set above
  useEffect(() => {
    const handleOnline = () => setNetworkStatus('online');
    const handleOffline = () => setNetworkStatus('offline');
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Fetch current match for this Lice
  useEffect(() => {
    if (!liceId) return;
    void (async () => {
      try {
        const res = await fetch(`${apiUrl}/api/v1/staff/lices/${liceId}/current-match`, {
          credentials: 'include',
        });
        if (!res.ok) {
          router.replace('/login');
          return;
        }
        const payload = (await res.json()) as {
          current: MatchInfo | null;
          event?: { slug?: string };
        };
        setCurrentMatch(
          payload.current ? { ...payload.current, eventSlug: payload.event?.slug } : null,
        );
      } catch {
        // Offline — show last cached state
      } finally {
        setLoading(false);
      }
    })();
  }, [liceId, apiUrl, router, refreshKey]);

  if (loading) {
    return (
      <main id="main-content" className="flex min-h-screen items-center justify-center">
        <p className="text-gray-400">{t('scoring.lice.loadingMatch')}</p>
      </main>
    );
  }

  return (
    <main id="main-content" className="min-h-screen flex flex-col">
      {/* Network status bar */}
      <div
        className={`px-4 py-1 text-xs font-bold text-center ${
          networkStatus === 'online'
            ? 'bg-green-900 text-green-300'
            : 'bg-red-900 text-red-300 animate-pulse'
        }`}
      >
        {networkStatus === 'online'
          ? `● ${t('scoring.lice.online')}`
          : `● ${t('scoring.lice.offlineQueued')}`}
      </div>

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <button
          onClick={() => router.push('/lices')}
          className="text-gray-400 hover:text-white text-sm"
        >
          ← {t('scoring.lice.backToLices')}
        </button>
        <h1 className="font-bold text-lg">{t('scoring.lice.title', { liceId })}</h1>
        <div className="w-16" />
      </header>

      {/* Match content */}
      {currentMatch ? (
        <MatchView
          match={currentMatch}
          apiUrl={apiUrl}
          networkStatus={networkStatus}
          onRefresh={() => setRefreshKey((key) => key + 1)}
        />
      ) : (
        <NoMatchView />
      )}
    </main>
  );
}
