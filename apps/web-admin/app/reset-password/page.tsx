'use client';

import Image from 'next/image';
import { useMemo, useState } from 'react';
import { validatePassword } from '@myclash/types';
import { AuthField, AuthNotice, AuthPanel, Button, PasswordChecklist } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { getPublicApiUrl } from '@/lib/api-url';

type Phase = 'idle' | 'submitting' | 'done';

/**
 * Set a new password, in the organizer app.
 *
 * This page exists because the recovery link used to open the participant app:
 * an organizer who asked on admin.${DOMAIN} finished on app.${DOMAIN}. The API
 * now points the link at the host that asked, and this is that host's page —
 * the same panel as the login, so the whole recovery goes end to end without
 * the domain changing under them.
 *
 * The token is read from `window` in a lazy initializer rather than through
 * `useSearchParams`, which would opt this component out of the React Compiler
 * and force a Suspense boundary. Nothing token-dependent is rendered before the
 * submit, so the server's null and the client's value cannot disagree visibly.
 */
export default function AdminResetPasswordPage() {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  // Supabase recovery links carry the token in the query (?token / ?token_hash)
  // or in the fragment (#token_hash / #access_token), depending on which leg of
  // the flow bounced. Read all four; the query wins because it survives a
  // server-side redirect.
  const [token] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const query = new URLSearchParams(window.location.search);
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    return (
      query.get('token') ??
      query.get('token_hash') ??
      fragment.get('token_hash') ??
      fragment.get('access_token')
    );
  });

  const validation = useMemo(() => validatePassword(password), [password]);

  async function submit(): Promise<void> {
    if (!token) {
      setError(t('auth.resetPassword.errors.missingToken'));
      return;
    }
    if (!validation.ok) {
      setError(t('admin.common.passwordMinLength'));
      return;
    }
    if (password !== confirm) {
      setError(t('admin.common.passwordsDoNotMatch'));
      return;
    }
    setPhase('submitting');
    setError(null);
    try {
      const res = await fetch(`${getPublicApiUrl()}/api/v1/auth/public-password-reset-confirm`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 401) {
        setError(t('auth.resetPassword.errors.expired'));
        setPhase('idle');
        return;
      }
      if (!res.ok) {
        setError(t('auth.resetPassword.errors.generic'));
        setPhase('idle');
        return;
      }
      // The reply carries `next: '/me'` — the participant landing, which this
      // host does not serve. The confirmation stays on this page rather than
      // riding a query parameter into /dashboard, because /dashboard is a
      // router: it forwards most organizers straight to their org workspace,
      // and anything rendered there would be gone before it could be read.
      setPhase('done');
    } catch {
      setError(t('auth.resetPassword.errors.network'));
      setPhase('idle');
    }
  }

  return (
    <AuthPanel
      mainId="main-content"
      brandHref="/"
      brandName={t('app.name')}
      eyebrow={t('auth.login.eyebrow')}
      title={t('auth.login.title')}
      subtitle={t('auth.login.subtitle')}
      brandMark={
        <Image
          src="/brand/Logomini_nobackground.png"
          alt=""
          width={48}
          height={48}
          priority
          className="h-11 w-11 lg:h-12 lg:w-12"
        />
      }
      heroArt={
        <Image
          src="/brand/Login_logo.png"
          alt=""
          width={1423}
          height={1007}
          className="mx-auto mb-8 h-auto w-full max-w-md"
          priority
        />
      }
      footer={
        phase === 'done' ? undefined : (
          <a href="/login" className="text-sm font-semibold text-muted hover:text-foreground">
            {t('auth.login.backToSignIn')}
          </a>
        )
      }
    >
      {phase === 'done' ? (
        <>
          <h2 className="text-2xl font-black">{t('auth.resetPassword.doneTitle')}</h2>
          <p className="text-sm leading-6 text-muted">{t('auth.resetPassword.doneDescription')}</p>
          <Button asChild variant="primary" className="w-full py-3">
            <a href="/dashboard">{t('auth.resetPassword.continue')}</a>
          </Button>
        </>
      ) : (
        <>
          <h2 className="text-2xl font-black">{t('auth.resetPassword.title')}</h2>
          <p className="text-sm leading-6 text-muted">{t('auth.resetPassword.description')}</p>

          <AuthField
            id="new-password"
            type="password"
            autoComplete="new-password"
            label={t('auth.resetPassword.newPassword')}
            placeholder={t('auth.signup.passwordPlaceholder')}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <AuthField
            id="new-password-confirm"
            type="password"
            autoComplete="new-password"
            label={t('auth.signup.passwordConfirmLabel')}
            placeholder={t('auth.signup.passwordConfirmPlaceholder')}
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />

          <PasswordChecklist failing={validation.failing} t={t} />

          <Button
            type="button"
            variant="primary"
            className="w-full py-3"
            disabled={phase === 'submitting' || !validation.ok || password !== confirm}
            loading={phase === 'submitting'}
            onClick={() => void submit()}
          >
            {phase === 'submitting' ? t('common.loading') : t('auth.resetPassword.submit')}
          </Button>

          {error && <AuthNotice tone="error">{error}</AuthNotice>}
        </>
      )}
    </AuthPanel>
  );
}
