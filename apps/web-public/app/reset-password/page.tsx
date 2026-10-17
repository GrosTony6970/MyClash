'use client';

import { Suspense, useMemo, useState } from 'react';
import { getPublicApiUrl } from '@/lib/api-url';
import { useRouter, useSearchParams } from 'next/navigation';
import { useI18n } from '@myclash/next-i18n/client';
import { NewPasswordForm } from '@/components/NewPasswordForm';
import { SignInWithNewPassword } from '@/components/SignInWithNewPassword';

type Phase = 'idle' | 'submitting' | 'done' | 'sign-in';

function ResetPassword() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
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

  async function submit(password: string): Promise<void> {
    if (!token) {
      setError(t('publicApp.resetPassword.errors.missingToken'));
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
      // The door says whether it handed a login for the new password (ruling 358).
      const body = (await res.json().catch(() => null)) as { signedIn?: unknown } | null;
      if (body?.signedIn !== true) {
        setPhase('sign-in');
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

  if (phase === 'sign-in') {
    return (
      <SignInWithNewPassword
        t={t}
        title={t('publicApp.resetPassword.title')}
        message={t('publicApp.resetPassword.doneSignIn')}
      />
    );
  }

  return (
    <NewPasswordForm
      t={t}
      title={t('publicApp.resetPassword.title')}
      description={t('publicApp.resetPassword.description')}
      submitLabel={t('publicApp.resetPassword.submit')}
      busy={phase === 'submitting'}
      error={error}
      onSubmit={(password) => void submit(password)}
    />
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPassword />
    </Suspense>
  );
}
