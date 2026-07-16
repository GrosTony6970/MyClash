'use client';

import { Suspense, useEffect, useState } from 'react';
import { getPublicApiUrl } from '@/lib/api-url';
import { Button } from '@myclash/ui';
import { useRouter, useSearchParams } from 'next/navigation';
import { useI18n } from '../../../../src/i18n/I18nProvider';
import { createOAuthSupabaseClient } from '../../../../src/lib/oauth-supabase';
import { runOAuthCodeOnce } from './single-flight';

type OAuthResponse = { next?: string };

type Phase = 'validating' | 'exchanging' | 'posting' | 'redirecting';

type CallbackError = {
  phase: Phase;
  messageKey: string;
  messageValues?: Record<string, string>;
  cause: { name: string; message: string };
};

class ServerRejectedError extends Error {
  readonly status: number;
  constructor(status: number, statusText: string) {
    super(`Server rejected with HTTP ${status} ${statusText}`);
    this.name = 'ServerRejectedError';
    this.status = status;
  }
}

class ParseFailedError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'ParseFailedError';
  }
}

class ValidationError extends Error {
  readonly messageKey: string;
  constructor(messageKey: string) {
    super(messageKey);
    this.name = 'ValidationError';
    this.messageKey = messageKey;
  }
}

function classifyError(phase: Phase, err: unknown): CallbackError {
  const cause = {
    name: err instanceof Error ? err.name : 'Error',
    message: err instanceof Error ? err.message : String(err),
  };

  if (err instanceof ValidationError) {
    return { phase, messageKey: err.messageKey, cause };
  }
  if (err instanceof ServerRejectedError) {
    return {
      phase,
      messageKey: 'auth.oauth.errors.serverRejected',
      messageValues: { status: String(err.status) },
      cause,
    };
  }
  if (err instanceof ParseFailedError) {
    return { phase, messageKey: 'auth.oauth.errors.parseFailed', cause };
  }
  if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return { phase, messageKey: 'auth.oauth.errors.timeout', cause };
  }
  if (phase === 'posting') {
    return { phase, messageKey: 'auth.oauth.errors.network', cause };
  }
  if (phase === 'exchanging') {
    return { phase, messageKey: 'auth.oauth.errors.exchangeFailed', cause };
  }
  if (phase === 'redirecting') {
    return { phase, messageKey: 'auth.oauth.errors.navigation', cause };
  }
  return { phase, messageKey: 'auth.oauth.errors.exchangeFailed', cause };
}

function PublicOAuthCallback() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<CallbackError | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function completeOAuth() {
      let phase: Phase = 'validating';
      try {
        const code = searchParams.get('code');
        const personId = searchParams.get('personId');
        const mode = searchParams.get('mode') ?? 'person_claim';
        const next = searchParams.get('next') ?? (mode === 'public_login' ? '/me' : '/');

        if (!code) {
          throw new ValidationError('auth.oauth.errors.missingCode');
        }
        if (mode !== 'person_claim' && mode !== 'public_login') {
          throw new ValidationError('auth.oauth.errors.notAuthorized');
        }
        if (mode === 'person_claim' && !personId) {
          throw new ValidationError('auth.oauth.errors.personMissing');
        }

        await runOAuthCodeOnce(code, async () => {
          phase = 'exchanging';
          const { data, error: exchangeError } =
            await createOAuthSupabaseClient().auth.exchangeCodeForSession(code);
          if (exchangeError || !data.session) {
            throw exchangeError ?? new Error('No session returned from PKCE exchange');
          }

          phase = 'posting';
          const apiUrl = getPublicApiUrl();
          const response = await fetch(`${apiUrl}/api/v1/auth/oauth/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            signal: AbortSignal.timeout(15000),
            body: JSON.stringify({
              accessToken: data.session.access_token,
              refreshToken: data.session.refresh_token ?? '',
              mode,
              ...(personId ? { personId } : {}),
              next,
            }),
          });

          if (!response.ok) {
            throw new ServerRejectedError(response.status, response.statusText);
          }

          let result: OAuthResponse;
          try {
            result = (await response.json()) as OAuthResponse;
          } catch (parseErr) {
            throw new ParseFailedError(parseErr);
          }

          phase = 'redirecting';
          router.replace(result.next ?? next);
        });
      } catch (err) {
        if (cancelled) return;
        const classified = classifyError(phase, err);
        console.error('[oauth-callback]', classified.phase, classified.cause);
        setError(classified);
      }
    }

    void completeOAuth();
    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  if (error) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-8">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-2xl font-bold mb-4">{t('auth.oauth.errorTitle')}</h1>
          <p className="text-danger" role="alert">
            {t(error.messageKey, error.messageValues)}
          </p>
          <details className="mt-4 text-left text-xs text-muted">
            <summary className="cursor-pointer">{t('auth.oauth.detailsToggle')}</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words">
              {error.phase}: {error.cause.name} — {error.cause.message}
            </pre>
          </details>
          <div className="mt-6">
            <Button onClick={() => router.replace('/login')}>{t('auth.oauth.backToLogin')}</Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-bold mb-4">{t('auth.oauth.completing')}</h1>
        <p className="text-foreground-secondary">{t('auth.oauth.wait')}</p>
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
