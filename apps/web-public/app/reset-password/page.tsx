'use client';

import { Suspense, useMemo, useState } from 'react';
import { getPublicApiUrl } from '@/lib/api-url';
import { Button, PasswordChecklist } from '@myclash/ui';
import { validatePassword } from '@myclash/types';
import { useRouter, useSearchParams } from 'next/navigation';
import { useI18n } from '../../src/i18n/I18nProvider';

type Phase = 'idle' | 'submitting' | 'done';

function ResetPassword() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  // Supabase recovery flows put the token in either ?token=… or in
  // the URL fragment (#token_hash=…). Read both, prefer the query
  // since it survives a server-side redirect. Hash is captured once
  // via lazy useState — it doesn't change after navigation.
  const [hashToken] = useState<string | null>(() => {
    if (typeof window === 'undefined' || !window.location.hash) return null;
    const params = new URLSearchParams(window.location.hash.slice(1));
    return params.get('token_hash') ?? params.get('access_token');
  });
  const token = useMemo(
    () => searchParams.get('token') ?? searchParams.get('token_hash') ?? hashToken,
    [searchParams, hashToken],
  );

  const validation = useMemo(() => validatePassword(password), [password]);

  async function submit(): Promise<void> {
    if (!token) {
      setError(t('publicApp.resetPassword.errors.missingToken'));
      return;
    }
    if (!validation.ok) {
      setError(t('publicApp.login.errors.weakPassword'));
      return;
    }
    if (password !== confirm) {
      setError(t('publicApp.login.errors.passwordMismatch'));
      return;
    }
    setPhase('submitting');
    setError(null);
    try {
      const apiUrl = getPublicApiUrl();
      const res = await fetch(`${apiUrl}/api/v1/auth/public-password-reset-confirm`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 401) {
        setError(t('publicApp.resetPassword.errors.expired'));
        setPhase('idle');
        return;
      }
      if (!res.ok) {
        setError(t('publicApp.resetPassword.errors.generic'));
        setPhase('idle');
        return;
      }
      setPhase('done');
      router.replace('/me?password_reset=1');
    } catch (err) {
      console.error('[reset-password]', err);
      setError(t('publicApp.resetPassword.errors.network'));
      setPhase('idle');
    }
  }

  return (
    <main
      data-theme="dark"
      data-accent="personal"
      className="min-h-screen bg-background px-4 py-10 text-foreground"
    >
      <div className="mx-auto max-w-md rounded-lg border border-border bg-surface p-8 shadow-2xl">
        <h1 className="text-2xl font-black">{t('publicApp.resetPassword.title')}</h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          {t('publicApp.resetPassword.description')}
        </p>

        <label className="mt-6 block">
          <span className="text-sm font-semibold text-foreground-secondary">
            {t('publicApp.resetPassword.newPassword')}
          </span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            className="mt-2 w-full rounded-md border border-border bg-background px-3 py-3 text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
        </label>

        <label className="mt-4 block">
          <span className="text-sm font-semibold text-foreground-secondary">
            {t('publicApp.login.passwordConfirmLabel')}
          </span>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            className="mt-2 w-full rounded-md border border-border bg-background px-3 py-3 text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
        </label>

        <PasswordChecklist failing={validation.failing} t={t} className="mt-3 space-y-1 text-xs" />

        <Button
          type="button"
          variant="primary"
          className="mt-5 w-full py-3"
          disabled={phase === 'submitting' || !validation.ok || password !== confirm}
          loading={phase === 'submitting'}
          onClick={() => void submit()}
        >
          {phase === 'submitting' ? t('common.loading') : t('publicApp.resetPassword.submit')}
        </Button>

        {error && (
          <p
            className="mt-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
            role="alert"
          >
            {error}
          </p>
        )}
      </div>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPassword />
    </Suspense>
  );
}
