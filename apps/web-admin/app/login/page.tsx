'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Button } from '@myclash/ui';
import { useI18n } from '../../src/i18n/I18nProvider';
import { createOAuthSupabaseClient } from '../../src/lib/oauth-supabase';

type LoadingAction = 'password' | 'magic_link' | 'google' | null;
type LoginResponse = { next?: string };

export default function LoginPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState<LoadingAction>(null);

  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const loading = loadingAction !== null;

  async function handleGoogleLogin() {
    setLoadingAction('google');
    setError(null);
    const redirectTo = `${window.location.origin}/auth/oauth/callback?next=${encodeURIComponent('/dashboard')}`;
    const { error: oauthError } = await createOAuthSupabaseClient().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
    if (oauthError) {
      setError(t('auth.oauth.errors.startFailed'));
      setLoadingAction(null);
    }
  }

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoadingAction('password');
    setError(null);

    try {
      const res = await fetch(`${apiUrl}/api/v1/auth/password-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password, redirectTo: '/dashboard' }),
      });

      if (res.status === 503) {
        throw new Error(t('admin.featureFlags.lockdownBanner'));
      }
      if (!res.ok) {
        throw new Error(t('auth.login.errors.passwordLoginFailed'));
      }

      const body = (await res.json()) as LoginResponse;
      window.location.href = body.next ?? '/dashboard';
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.login.errors.passwordLoginFailed'));
    } finally {
      setLoadingAction(null);
    }
  }

  async function handleMagicLink() {
    setLoadingAction('magic_link');
    setError(null);

    try {
      const res = await fetch(`${apiUrl}/api/v1/auth/magic-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, type: 'login', redirectTo: '/dashboard' }),
      });

      if (!res.ok) {
        throw new Error(t('auth.login.errors.magicLinkFailed'));
      }

      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.login.errors.magicLinkFailed'));
    } finally {
      setLoadingAction(null);
    }
  }

  if (submitted) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-8">
        <div className="w-full max-w-sm text-center">
          <Image
            src="/brand/Logo_nobackground.png"
            alt={t('metadata.adminTitle')}
            width={88}
            height={88}
            priority
            className="mx-auto mb-5 h-20 w-20"
          />
          <h1 className="text-2xl font-bold mb-4">{t('auth.login.checkEmailTitle')}</h1>
          <p className="text-gray-600">
            {t('auth.login.checkEmailPrefix')} <strong>{email}</strong>.{' '}
            {t('auth.login.checkEmailSuffix')}
          </p>
          <p className="mt-4 text-sm text-gray-400">{t('auth.login.linkExpires')}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-sm">
        <Image
          src="/brand/Logo_nobackground.png"
          alt={t('metadata.adminTitle')}
          width={88}
          height={88}
          priority
          className="mb-5 h-20 w-20"
        />
        <h1 className="text-2xl font-bold mb-2">{t('auth.login.title')}</h1>
        <p className="text-gray-600 mb-8">{t('auth.login.subtitle')}</p>

        <form
          onSubmit={(e) => {
            void handlePasswordLogin(e);
          }}
          className="flex flex-col gap-4"
        >
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-1">
              {t('auth.login.emailAddress')}
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('auth.login.emailPlaceholder')}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium mb-1">
              {t('auth.login.password')}
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('auth.login.passwordPlaceholder')}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}

          <Button
            type="submit"
            disabled={loading}
            loading={loadingAction === 'password'}
            variant="next"
            className="w-full"
          >
            {loadingAction === 'password' ? t('auth.login.signingIn') : t('auth.login.signIn')}
          </Button>
        </form>

        <Button
          type="button"
          onClick={() => {
            void handleMagicLink();
          }}
          disabled={loading || !email}
          loading={loadingAction === 'magic_link'}
          variant="back"
          className="mt-3 w-full"
        >
          {loadingAction === 'magic_link' ? t('auth.login.sending') : t('auth.login.sendLoginLink')}
        </Button>

        <Button
          type="button"
          onClick={() => {
            void handleGoogleLogin();
          }}
          disabled={loading}
          loading={loadingAction === 'google'}
          variant="back"
          className="mt-3 w-full"
        >
          {t('auth.oauth.continueWithGoogle')}
        </Button>

        <p className="mt-6 text-center text-sm text-gray-500">
          {t('auth.login.signupPrompt')}{' '}
          <Link href="/signup" className="text-red-700 hover:underline">
            {t('auth.login.signupLink')}
          </Link>
        </p>
      </div>
    </main>
  );
}
