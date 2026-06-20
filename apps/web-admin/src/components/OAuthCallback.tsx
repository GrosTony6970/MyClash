'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useI18n } from '../i18n/I18nProvider';
import { createOAuthSupabaseClient } from '../lib/oauth-supabase';
import { runOAuthCodeOnce } from '../lib/oauth-single-flight';
import { resolvePostAuthDestination } from '../lib/post-auth-destination';

type OAuthMode = 'admin_login' | 'organizer_signup';
type OAuthResponse = { next?: string };
type PendingSignup = { orgName: string; orgSlug: string };

const SIGNUP_STORAGE_KEY = 'myclash.oauth.organizerSignup';

class OAuthCallbackFailure extends Error {
  constructor(readonly messageKey: string) {
    super(messageKey);
  }
}

export function savePendingOrganizerSignup(value: PendingSignup) {
  sessionStorage.setItem(SIGNUP_STORAGE_KEY, JSON.stringify(value));
}

function readPendingOrganizerSignup(): PendingSignup | null {
  const raw = sessionStorage.getItem(SIGNUP_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingSignup>;
    if (typeof parsed.orgName === 'string' && typeof parsed.orgSlug === 'string') {
      return { orgName: parsed.orgName, orgSlug: parsed.orgSlug };
    }
  } catch {
    // Invalid storage is treated as a missing signup context.
  }
  return null;
}

export function OAuthCallback({ mode }: { mode: OAuthMode }) {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function completeOAuth() {
      const code = searchParams.get('code');
      if (!code) {
        if (!cancelled) setError(t('auth.oauth.errors.missingCode'));
        return;
      }

      try {
        await runOAuthCodeOnce(code, async () => {
          const { data, error: exchangeError } =
            await createOAuthSupabaseClient().auth.exchangeCodeForSession(code);
          if (exchangeError || !data.session) {
            throw new OAuthCallbackFailure('auth.oauth.errors.exchangeFailed');
          }

          const body: Record<string, string> = {
            accessToken: data.session.access_token,
            refreshToken: data.session.refresh_token ?? '',
            mode,
            next: searchParams.get('next') ?? '/',
          };

          if (mode === 'organizer_signup') {
            const pending = readPendingOrganizerSignup();
            if (!pending) {
              throw new OAuthCallbackFailure('auth.oauth.errors.signupContextMissing');
            }
            body['orgName'] = pending.orgName;
            body['orgSlug'] = pending.orgSlug;
          }

          const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
          const response = await fetch(`${apiUrl}/api/v1/auth/oauth/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(body),
          });

          if (!response.ok) {
            throw new OAuthCallbackFailure('auth.oauth.errors.notAuthorized');
          }

          if (mode === 'organizer_signup') {
            sessionStorage.removeItem(SIGNUP_STORAGE_KEY);
          }

          const result = (await response.json()) as OAuthResponse;
          // Mirror the password-login path: server-picked `next` wins, otherwise
          // auto-route organizers into their primary org's auto-selected event.
          const destination = result.next ?? (await resolvePostAuthDestination('/dashboard'));
          router.replace(destination);
        });
      } catch (err) {
        if (cancelled) return;
        const key =
          err instanceof OAuthCallbackFailure ? err.messageKey : 'auth.oauth.errors.exchangeFailed';
        setError(t(key));
      }
    }

    void completeOAuth();
    return () => {
      cancelled = true;
    };
  }, [mode, router, searchParams, t]);

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
