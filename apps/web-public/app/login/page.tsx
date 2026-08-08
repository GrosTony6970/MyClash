'use client';

import Image from 'next/image';
import { getPublicApiUrl } from '@/lib/api-url';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Button, GoogleIcon, PasswordChecklist } from '@myclash/ui';
import { validatePassword } from '@myclash/types';
import { LegalConsent } from '../../src/components/LegalConsent';
import { useI18n } from '../../src/i18n/I18nProvider';
import { currentLegalVersionFields } from '../../src/lib/legal-url';
import { createOAuthSupabaseClient } from '../../src/lib/oauth-supabase';

type Tab = 'signin' | 'signup' | 'reset';

export default function PublicLoginPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('signin');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [acceptedLegal, setAcceptedLegal] = useState(false);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apiUrl = getPublicApiUrl();

  const passwordValidation = useMemo(() => validatePassword(password), [password]);

  function reset() {
    setMessage(null);
    setError(null);
  }

  async function handlePasswordSignIn() {
    if (!email.trim() || !password || busy) return;
    setBusy(true);
    reset();
    try {
      const res = await fetch(`${apiUrl}/api/v1/auth/public-login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (res.status === 403) {
        const body = (await res.json().catch(() => ({}))) as { code?: string };
        if (body.code === 'email_not_confirmed') {
          setError(t('publicApp.login.errors.emailNotConfirmed'));
          return;
        }
      }
      if (!res.ok) {
        setError(t('publicApp.login.errors.passwordLoginFailed'));
        return;
      }
      router.replace('/me');
    } catch {
      setError(t('publicApp.login.errors.passwordLoginFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function handleSignUp() {
    if (!email.trim() || !password || busy) return;
    if (!acceptedLegal) {
      setError(t('legal.accept.required'));
      return;
    }
    if (!passwordValidation.ok) {
      setError(t('publicApp.login.errors.weakPassword'));
      return;
    }
    if (password !== passwordConfirm) {
      setError(t('publicApp.login.errors.passwordMismatch'));
      return;
    }
    setBusy(true);
    reset();
    try {
      const res = await fetch(`${apiUrl}/api/v1/auth/public-signup`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password,
          // Checked server-side against the published registry; a stale pair is
          // refused so a tab open across a policy revision cannot consent to the
          // old text.
          ...currentLegalVersionFields(),
        }),
      });
      if (res.status === 503) {
        setError(t('publicApp.login.errors.signupsDisabled'));
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string };
        setError(
          body.code === 'legal_version_stale'
            ? t('legal.accept.stale')
            : t('publicApp.login.errors.signupFailed'),
        );
        return;
      }
      setMessage(t('publicApp.login.signupCheckEmail', { email: email.trim() }));
    } catch {
      setError(t('publicApp.login.errors.signupFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function handleSendMagicLink() {
    if (!email.trim() || busy) return;
    setBusy(true);
    reset();
    try {
      const res = await fetch(`${apiUrl}/api/v1/auth/magic-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: email.trim(),
          type: 'public_login',
          redirectTo: '/me',
        }),
      });
      if (!res.ok) throw new Error('magic-link');
      setMessage(t('publicApp.login.checkEmail'));
    } catch {
      setError(t('publicApp.login.errors.magicLinkFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function handleResetRequest() {
    if (!email.trim() || busy) return;
    setBusy(true);
    reset();
    try {
      await fetch(`${apiUrl}/api/v1/auth/public-password-reset`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      setMessage(t('publicApp.login.resetCheckEmail'));
    } catch {
      setMessage(t('publicApp.login.resetCheckEmail'));
    } finally {
      setBusy(false);
    }
  }

  async function continueWithGoogle() {
    reset();
    try {
      const redirectTo = `${window.location.origin}/auth/oauth/callback?mode=public_login&next=${encodeURIComponent('/me')}`;
      const { error: oauthError } = await createOAuthSupabaseClient().auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      });
      if (!oauthError) return;
      setError(t('auth.oauth.errors.startFailed'));
    } catch {
      setError(t('auth.oauth.errors.startFailed'));
    }
  }

  return (
    <main
      id="main-content"
      data-theme="dark"
      data-accent="personal"
      className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6"
    >
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-5xl items-center justify-center">
        <section className="grid w-full overflow-hidden rounded-lg border border-border bg-surface shadow-2xl lg:grid-cols-[1fr_460px]">
          <div className="relative hidden min-h-[560px] overflow-hidden bg-surface p-8 lg:block">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,color-mix(in_srgb,var(--color-accent)_35%,transparent),transparent_34%),radial-gradient(circle_at_80%_10%,color-mix(in_srgb,var(--color-warning)_24%,transparent),transparent_26%),linear-gradient(135deg,var(--color-background),var(--color-surface)_55%,var(--color-border))]" />
            <div className="relative flex h-full flex-col justify-between">
              <Link href="/" className="flex items-center gap-3">
                <Image
                  src="/brand/Logomini_nobackground.png"
                  alt=""
                  width={48}
                  height={48}
                  priority
                />
                <div>
                  <p className="font-display text-xl font-bold">{t('app.name')}</p>
                  <p className="text-xs font-bold uppercase tracking-[0.22em] text-gold">
                    {t('publicApp.login.eyebrow')}
                  </p>
                </div>
              </Link>
              <div>
                <Image
                  src="/brand/Login_logo.png"
                  alt=""
                  width={1423}
                  height={1007}
                  className="mx-auto mb-8 h-auto w-full max-w-md"
                  priority
                />
                <h1 className="max-w-lg text-4xl font-black leading-tight">
                  {t('publicApp.login.title')}
                </h1>
                <p className="mt-4 max-w-md text-sm leading-6 text-muted">
                  {t('publicApp.login.subtitle')}
                </p>
              </div>
            </div>
          </div>

          <div className="p-5 sm:p-8">
            <div className="mb-6 flex items-center gap-3 lg:hidden">
              <Image src="/brand/Logomini_nobackground.png" alt="" width={44} height={44} />
              <div>
                <p className="font-display text-lg font-bold">{t('app.name')}</p>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-gold">
                  {t('publicApp.login.eyebrow')}
                </p>
              </div>
            </div>

            <div
              role="tablist"
              aria-label={t('publicApp.login.tabsLabel')}
              className="mb-5 flex gap-1 rounded-md bg-background p-1"
            >
              <TabButton
                current={tab}
                value="signin"
                onClick={() => {
                  setTab('signin');
                  reset();
                }}
                label={t('publicApp.login.tabSignIn')}
              />
              <TabButton
                current={tab}
                value="signup"
                onClick={() => {
                  setTab('signup');
                  reset();
                }}
                label={t('publicApp.login.tabSignUp')}
              />
            </div>

            <div className="space-y-4">
              {tab === 'reset' ? (
                <>
                  <h2 className="text-2xl font-black">{t('publicApp.login.resetTitle')}</h2>
                  <p className="text-sm leading-6 text-muted">
                    {t('publicApp.login.resetDescription')}
                  </p>
                </>
              ) : (
                <>
                  <h2 className="text-2xl font-black">
                    {tab === 'signin'
                      ? t('publicApp.login.formTitle')
                      : t('publicApp.login.signupTitle')}
                  </h2>
                  <p className="text-sm leading-6 text-muted">
                    {tab === 'signin'
                      ? t('publicApp.login.formDescription')
                      : t('publicApp.login.signupDescription')}
                  </p>
                </>
              )}

              <label className="block">
                <span className="text-sm font-semibold text-foreground">
                  {t('auth.login.emailAddress')}
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder={t('auth.login.emailPlaceholder')}
                  className="mt-2 w-full rounded-md border border-border bg-background px-3 py-3 text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30"
                />
              </label>

              {(tab === 'signin' || tab === 'signup') && (
                <label className="block">
                  <span className="text-sm font-semibold text-foreground">
                    {t('auth.login.password')}
                  </span>
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={t('auth.login.passwordPlaceholder')}
                    autoComplete={tab === 'signup' ? 'new-password' : 'current-password'}
                    className="mt-2 w-full rounded-md border border-border bg-background px-3 py-3 text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30"
                  />
                </label>
              )}

              {tab === 'signup' && (
                <>
                  <label className="block">
                    <span className="text-sm font-semibold text-foreground">
                      {t('publicApp.login.passwordConfirmLabel')}
                    </span>
                    <input
                      type="password"
                      value={passwordConfirm}
                      onChange={(event) => setPasswordConfirm(event.target.value)}
                      autoComplete="new-password"
                      className="mt-2 w-full rounded-md border border-border bg-background px-3 py-3 text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30"
                    />
                  </label>
                  <PasswordChecklist failing={passwordValidation.failing} t={t} />
                  <LegalConsent checked={acceptedLegal} onChange={setAcceptedLegal} />
                </>
              )}

              {tab === 'signin' && (
                <Button
                  type="button"
                  disabled={busy}
                  loading={busy}
                  variant="primary"
                  className="w-full py-3"
                  onClick={() => void handlePasswordSignIn()}
                >
                  {busy ? t('auth.login.signingIn') : t('auth.login.signIn')}
                </Button>
              )}

              {tab === 'signup' && (
                <Button
                  type="button"
                  disabled={
                    busy || !acceptedLegal || !passwordValidation.ok || password !== passwordConfirm
                  }
                  loading={busy}
                  variant="primary"
                  className="w-full py-3"
                  onClick={() => void handleSignUp()}
                >
                  {busy ? t('common.loading') : t('publicApp.login.createAccount')}
                </Button>
              )}

              {tab === 'reset' && (
                <Button
                  type="button"
                  disabled={busy}
                  loading={busy}
                  variant="primary"
                  className="w-full py-3"
                  onClick={() => void handleResetRequest()}
                >
                  {busy ? t('common.loading') : t('publicApp.login.sendResetLink')}
                </Button>
              )}

              {tab === 'signin' && (
                <button
                  type="button"
                  onClick={() => {
                    setTab('reset');
                    reset();
                  }}
                  className="text-xs font-semibold text-muted underline-offset-2 hover:text-foreground hover:underline"
                >
                  {t('publicApp.login.forgotPassword')}
                </button>
              )}

              {tab !== 'reset' && (
                <>
                  <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-muted">
                    <span className="h-px flex-1 bg-border" />
                    <span>{t('publicApp.login.or')}</span>
                    <span className="h-px flex-1 bg-border" />
                  </div>

                  <Button
                    type="button"
                    disabled={busy}
                    loading={busy}
                    variant="ghost"
                    className="w-full py-3"
                    onClick={() => void handleSendMagicLink()}
                  >
                    {t('publicApp.login.sendMagicLink')}
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full py-3"
                    leftIcon={<GoogleIcon />}
                    onClick={() => void continueWithGoogle()}
                  >
                    {t('auth.oauth.continueWithGoogle')}
                  </Button>
                </>
              )}

              {message && (
                <p
                  className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success"
                  role="status"
                >
                  {message}
                </p>
              )}
              {error && (
                <p
                  className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
                  role="alert"
                >
                  {error}
                </p>
              )}

              <div className="border-t border-border pt-4">
                {tab === 'reset' ? (
                  <button
                    type="button"
                    onClick={() => {
                      setTab('signin');
                      reset();
                    }}
                    className="text-sm font-semibold text-muted hover:text-foreground"
                  >
                    ← {t('publicApp.login.tabSignIn')}
                  </button>
                ) : (
                  <Link href="/" className="text-sm font-semibold text-muted hover:text-foreground">
                    {t('publicApp.login.backToEvents')}
                  </Link>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function TabButton({
  current,
  value,
  onClick,
  label,
}: {
  current: Tab;
  value: Tab;
  onClick: () => void;
  label: string;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={[
        'flex-1 rounded-md px-3 py-2 text-sm font-bold transition',
        active ? 'bg-accent text-accent-foreground shadow' : 'text-muted hover:text-foreground',
      ].join(' ')}
    >
      {label}
    </button>
  );
}
