'use client';

import Image from 'next/image';
import { getPublicApiUrl } from '@/lib/api-url';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  AuthDivider,
  AuthNotice,
  AuthPanel,
  Button,
  GoogleIcon,
  PasswordChecklist,
  authFieldClass,
} from '@myclash/ui';
import type { AuthPanelTab } from '@myclash/ui';
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

  const tabs: ReadonlyArray<AuthPanelTab<Tab>> = [
    { value: 'signin', label: t('publicApp.login.tabSignIn') },
    { value: 'signup', label: t('publicApp.login.tabSignUp') },
  ];

  return (
    <AuthPanel<Tab>
      mainId="main-content"
      accent="personal"
      brandHref="/"
      brandName={t('app.name')}
      eyebrow={t('publicApp.login.eyebrow')}
      title={t('publicApp.login.title')}
      subtitle={t('publicApp.login.subtitle')}
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
      tabs={tabs}
      activeTab={tab}
      onTabChange={(value) => {
        setTab(value);
        reset();
      }}
      tabsLabel={t('publicApp.login.tabsLabel')}
      footer={
        tab === 'reset' ? (
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
        )
      }
    >
      {tab === 'reset' ? (
        <>
          <h2 className="text-2xl font-black">{t('publicApp.login.resetTitle')}</h2>
          <p className="text-sm leading-6 text-muted">{t('publicApp.login.resetDescription')}</p>
        </>
      ) : (
        <>
          <h2 className="text-2xl font-black">
            {tab === 'signin' ? t('publicApp.login.formTitle') : t('publicApp.login.signupTitle')}
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
          className={authFieldClass}
        />
      </label>

      {(tab === 'signin' || tab === 'signup') && (
        <label className="block">
          <span className="text-sm font-semibold text-foreground">{t('auth.login.password')}</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={t('auth.login.passwordPlaceholder')}
            autoComplete={tab === 'signup' ? 'new-password' : 'current-password'}
            className={authFieldClass}
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
              className={authFieldClass}
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
          <AuthDivider label={t('publicApp.login.or')} />

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

      {message && <AuthNotice tone="success">{message}</AuthNotice>}
      {error && <AuthNotice tone="error">{error}</AuthNotice>}
    </AuthPanel>
  );
}
