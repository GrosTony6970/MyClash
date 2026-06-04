'use client';

import Image from 'next/image';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { t } from '@myclash/i18n';
import { getApiUrl } from '../src/lib/api-url';

/**
 * Root page - checks auth and redirects:
 * - Authenticated -> /lices
 * - Anonymous -> /login
 */
export default function RootPage() {
  const router = useRouter();
  const apiUrl = getApiUrl();

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${apiUrl}/api/v1/me`, { credentials: 'include' });
        const me = (await res.json()) as { type: string };
        if (me.type === 'anonymous') {
          router.replace('/login');
        } else {
          router.replace('/lices');
        }
      } catch {
        // Offline or API unreachable - go to login
        router.replace('/login');
      }
    })();
  }, [apiUrl, router]);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <Image
          src="/brand/Logomini_nobackground.png"
          alt={t('metadata.scoringTitle')}
          width={56}
          height={56}
          priority
          className="mx-auto mb-3 h-14 w-14"
        />
        <p className="text-gray-400 text-sm">{t('common.loading')}</p>
      </div>
    </main>
  );
}
