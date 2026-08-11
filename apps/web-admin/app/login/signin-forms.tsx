'use client';

import { AuthDivider, AuthField, Button, GoogleIcon } from '@myclash/ui';

/** Panels take the translator as a prop, so none of them needs the context. */
export type Translate = (key: string) => string;

export type LoadingAction = 'password' | 'magic_link' | 'google' | 'reset' | 'signup' | null;

// ── Sign in ────────────────────────────────────────────────────────────────

export function SignInForm({
  t,
  email,
  password,
  onEmail,
  onPassword,
  loadingAction,
  onSubmit,
  onForgotPassword,
}: {
  t: Translate;
  email: string;
  password: string;
  onEmail: (value: string) => void;
  onPassword: (value: string) => void;
  loadingAction: LoadingAction;
  onSubmit: (event: React.FormEvent) => void;
  onForgotPassword: () => void;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <AuthField
        id="email"
        type="email"
        required
        autoComplete="email"
        label={t('auth.login.emailAddress')}
        placeholder={t('auth.login.emailPlaceholder')}
        value={email}
        onChange={(event) => onEmail(event.target.value)}
      />
      <AuthField
        id="password"
        type="password"
        required
        autoComplete="current-password"
        label={t('auth.login.password')}
        placeholder={t('auth.login.passwordPlaceholder')}
        value={password}
        onChange={(event) => onPassword(event.target.value)}
      />
      <Button
        type="submit"
        variant="primary"
        className="w-full py-3"
        disabled={loadingAction !== null}
        loading={loadingAction === 'password'}
      >
        {loadingAction === 'password' ? t('auth.login.signingIn') : t('auth.login.signIn')}
      </Button>
      <button
        type="button"
        onClick={onForgotPassword}
        className="text-xs font-semibold text-muted underline-offset-2 hover:text-foreground hover:underline"
      >
        {t('auth.login.forgotPassword')}
      </button>
    </form>
  );
}

// ── Password reset request ─────────────────────────────────────────────────

export function ResetForm({
  t,
  email,
  onEmail,
  loadingAction,
  onSubmit,
}: {
  t: Translate;
  email: string;
  onEmail: (value: string) => void;
  loadingAction: LoadingAction;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <AuthField
        id="reset-email"
        type="email"
        required
        autoComplete="email"
        label={t('auth.login.emailAddress')}
        placeholder={t('auth.login.emailPlaceholder')}
        value={email}
        onChange={(event) => onEmail(event.target.value)}
      />
      <Button
        type="submit"
        variant="primary"
        className="w-full py-3"
        disabled={loadingAction !== null || !email}
        loading={loadingAction === 'reset'}
      >
        {loadingAction === 'reset' ? t('auth.login.resetSending') : t('auth.login.sendResetLink')}
      </Button>
    </form>
  );
}

// ── The alternative methods, under the primary action ──────────────────────

export function AlternativeMethods({
  t,
  mode,
  email,
  loadingAction,
  onMagicLink,
  onGoogle,
}: {
  t: Translate;
  mode: 'signin' | 'signup';
  email: string;
  loadingAction: LoadingAction;
  onMagicLink: () => void;
  onGoogle: () => void;
}) {
  const busy = loadingAction !== null;
  const linkLabel =
    mode === 'signin'
      ? loadingAction === 'magic_link'
        ? t('auth.login.sending')
        : t('auth.login.sendLoginLink')
      : t('auth.signup.continueWithLink');

  return (
    <>
      <AuthDivider label={t('auth.login.or')} />
      <Button
        type="button"
        variant="ghost"
        className="w-full py-3"
        disabled={busy || (mode === 'signin' && !email)}
        loading={loadingAction === 'magic_link'}
        onClick={onMagicLink}
      >
        {linkLabel}
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="w-full py-3"
        disabled={busy}
        loading={loadingAction === 'google'}
        leftIcon={<GoogleIcon />}
        onClick={onGoogle}
      >
        {t('auth.oauth.continueWithGoogle')}
      </Button>
    </>
  );
}
