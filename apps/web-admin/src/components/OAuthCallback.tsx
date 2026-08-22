'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useI18n } from '@myclash/next-i18n/client';
import { createOAuthSupabaseClient } from '../lib/oauth-supabase';
import { runOAuthCodeOnce } from '../lib/oauth-single-flight';
import { resolvePostAuthDestination } from '../lib/post-auth-destination';
import { apiRequest } from '@myclash/api-client';
import { getPublicApiUrl } from '../lib/api-url';

type OAuthMode = 'admin_login' | 'organizer_signup';
type OAuthResponse = { next?: string };
type PendingSignup = {
  orgName: string;
  orgSlug: string;
  /**
   * Policy versions the signup form displayed. Carried through sessionStorage
   * because the Google round-trip leaves and re-enters the app, and the server
   * refuses an organizer_signup that arrives without them.
   */
  acceptedTerms: string;
  acceptedPrivacy: string;
};

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
    if (
      typeof parsed.orgName === 'string' &&
      typeof parsed.orgSlug === 'string' &&
      typeof parsed.acceptedTerms === 'string' &&
      typeof parsed.acceptedPrivacy === 'string'
    ) {
      return {
        orgName: parsed.orgName,
        orgSlug: parsed.orgSlug,
        acceptedTerms: parsed.acceptedTerms,
        acceptedPrivacy: parsed.acceptedPrivacy,
      };
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
            body['acceptedTerms'] = pending.acceptedTerms;
            body['acceptedPrivacy'] = pending.acceptedPrivacy;
          }

          const r = await apiRequest<OAuthResponse>(
            getPublicApiUrl(),
            '/api/v1/auth/oauth/session',
            {
              method: 'POST',
              body,
            },
          );

          if (!r.ok) {
            // Keeps its own i18n KEY rather than the server's sentence: this
            // screen renders `t(key)` for every outcome, and the exchange
            // failing means one thing to the person in front of it — this
            // Google account is not authorised here.
            throw new OAuthCallbackFailure('auth.oauth.errors.notAuthorized');
          }

          if (mode === 'organizer_signup') {
            sessionStorage.removeItem(SIGNUP_STORAGE_KEY);
          }

          const result = r.data;
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
        <h1 className="font-display font-bold text-2xl sm:text-3xl mb-4">
          {error ? t('auth.oauth.errorTitle') : t('auth.oauth.completing')}
        </h1>
        <p
          className={error ? 'text-danger' : 'text-foreground-secondary'}
          role={error ? 'alert' : undefined}
        >
          {error ?? t('auth.oauth.wait')}
        </p>
      </div>
    </main>
  );
}
