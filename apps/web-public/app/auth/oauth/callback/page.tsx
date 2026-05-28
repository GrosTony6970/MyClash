'use client';

import { Suspense, useEffect, useState } from 'react';
import { getApiUrl } from '@/lib/api-url';
import { useRouter, useSearchParams } from 'next/navigation';
import { useI18n } from '../../../../src/i18n/I18nProvider';
import { createOAuthSupabaseClient } from '../../../../src/lib/oauth-supabase';

type OAuthResponse = { next?: string };

function PublicOAuthCallback() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function completeOAuth() {
      const code = searchParams.get('code');
      const personId = searchParams.get('personId');
      const mode = searchParams.get('mode') ?? 'person_claim';
      const next = searchParams.get('next') ?? (mode === 'public_login' ? '/me' : '/');

      if (!code) {
        if (!cancelled) setError(t('auth.oauth.errors.missingCode'));
        return;
      }
      if (mode !== 'person_claim' && mode !== 'public_login') {
        if (!cancelled) setError(t('auth.oauth.errors.notAuthorized'));
        return;
      }
      if (mode === 'person_claim' && !personId) {
        if (!cancelled) setError(t('auth.oauth.errors.personMissing'));
        return;
      }

      const { data, error: exchangeError } =
        await createOAuthSupabaseClient().auth.exchangeCodeForSession(code);
      if (exchangeError || !data.session) {
        if (!cancelled) setError(t('auth.oauth.errors.exchangeFailed'));
        return;
      }

      const apiUrl = getApiUrl();
      const response = await fetch(`${apiUrl}/api/v1/auth/oauth/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token ?? '',
          mode,
          ...(personId ? { personId } : {}),
          next,
        }),
      });

      if (!response.ok) {
        if (!cancelled) setError(t('auth.oauth.errors.notAuthorized'));
        return;
      }

      const result = (await response.json()) as OAuthResponse;
      router.replace(result.next ?? next);
    }

    void completeOAuth();
    return () => {
      cancelled = true;
    };
  }, [router, searchParams, t]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-bold mb-4">
          {error ? t('auth.oauth.errorTitle') : t('auth.oauth.completing')}
        </h1>
        <p className={error ? 'text-red-600' : 'text-gray-600'} role={error ? 'alert' : undefined}>
          {error ?? t('auth.oauth.wait')}
        </p>
      </div>
    </main>
  );
}

export default function PublicOAuthCallbackPage() {
  return (
    <Suspense fallback={null}>
      <PublicOAuthCallback />
    </Suspense>
  );
}
