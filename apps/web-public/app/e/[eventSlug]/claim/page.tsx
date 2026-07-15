'use client';

import { useSearchParams } from 'next/navigation';
import { getApiUrl } from '@/lib/api-url';
import { Suspense, useState } from 'react';
import { GoogleIcon } from '@myclash/ui';
import { useI18n } from '../../../../src/i18n/I18nProvider';
import { createOAuthSupabaseClient } from '../../../../src/lib/oauth-supabase';

function ClaimForm() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const personId = searchParams.get('personId') ?? '';

  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const apiUrl = getApiUrl();

  async function handleGoogleClaim() {
    if (!personId) {
      setError(t('auth.oauth.errors.personMissing'));
      return;
    }
    setLoading(true);
    setError(null);
    const next = searchParams.get('next') ?? '/';
    const redirectTo = `${window.location.origin}/auth/oauth/callback?mode=person_claim&personId=${encodeURIComponent(personId)}&next=${encodeURIComponent(next)}`;
    const { error: oauthError } = await createOAuthSupabaseClient().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
    if (oauthError) {
      setError(t('auth.oauth.errors.startFailed'));
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!personId) {
      setError(t('publicApp.claim.missingPersonId'));
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${apiUrl}/api/v1/auth/magic-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, type: 'claim', personId }),
      });

      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? t('publicApp.claim.errors.generic'));
      }

      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('publicApp.claim.errors.generic'));
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="w-full max-w-sm text-center">
        <h1 className="font-display font-bold text-2xl sm:text-3xl mb-4">
          {t('publicApp.claim.sentTitle')}
        </h1>
        <p className="text-foreground-secondary">
          {t('publicApp.claim.confirmSentPrefix')} <strong>{email}</strong>.{' '}
          {t('publicApp.claim.confirmSentSuffix')}
        </p>
        <p className="mt-4 text-sm text-muted">{t('publicApp.claim.linkExpires')}</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm">
      <h1 className="font-display font-bold text-2xl sm:text-3xl mb-2">
        {t('publicApp.claim.confirmProfileTitle')}
      </h1>
      <p className="text-foreground-secondary mb-8">
        {t('publicApp.claim.confirmProfileDescription')}
      </p>

      <form
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
        className="flex flex-col gap-4"
      >
        <div>
          <label htmlFor="email" className="block text-sm font-medium mb-1">
            {t('publicApp.claim.registeredEmailLabel')}
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('publicApp.claim.emailPlaceholder')}
            className="w-full border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !personId}
          className="w-full bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-foreground font-semibold py-2 px-4 rounded-md transition-colors"
        >
          {loading ? t('publicApp.claim.sending') : t('publicApp.claim.sendConfirmationLink')}
        </button>
      </form>

      <button
        type="button"
        onClick={() => {
          void handleGoogleClaim();
        }}
        disabled={loading || !personId}
        className="mt-3 w-full inline-flex items-center justify-center gap-2 border border-border hover:border-accent disabled:opacity-50 text-foreground font-semibold py-2 px-4 rounded-md transition-colors"
      >
        <GoogleIcon />
        {t('auth.oauth.continueWithGoogle')}
      </button>

      <p className="mt-6 text-sm text-muted">
        {t('publicApp.claim.emailMismatch')}{' '}
        <span className="text-foreground-secondary">
          {t('publicApp.claim.emailMismatchAction')}
        </span>
      </p>
    </div>
  );
}

export default function ClaimPage() {
  const { t } = useI18n();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <Suspense fallback={<p className="text-muted">{t('publicApp.claim.loading')}</p>}>
        <ClaimForm />
      </Suspense>
    </main>
  );
}
