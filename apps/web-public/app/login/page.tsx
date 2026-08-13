'use client';

import Image from 'next/image';
import { getPublicApiUrl } from '@/lib/api-url';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  AuthAltLink,
  AuthDivider,
  AuthField,
  AuthNotice,
  AuthPanel,
  Button,
  GoogleIcon,
  PasswordChecklist,
} from '@myclash/ui';
import type { AuthPanelTab } from '@myclash/ui';
import { validatePassword } from '@myclash/types';
import { BackLink } from '../../src/components/BackLink';
import { LegalConsent } from '../../src/components/LegalConsent';
import { useI18n } from '@myclash/next-i18n/client';
import {
  requestMagicLink,
  requestPasswordReset,
  requestPasswordSignIn,
  requestSignUp,
  startGoogleSignIn,
} from './auth-requests';

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
  // The organizer workspace is a different host, so the cross-link needs the
  // build-time value the rest of the app already reads (SiteHeader,
  // PublicPersonalShell). Passed by both compose files; the default is the
  // production host so a bare `next build` still emits a working link.
  const adminUrl = process.env['NEXT_PUBLIC_ADMIN_URL'] ?? 'https://admin.myclash.fr';

  const passwordValidation = useMemo(() => validatePassword(password), [password]);

  function reset() {
    setMessage(null);
    setError(null);
  }

  async function handlePasswordSignIn() {
    if (!email.trim() || !password || busy) return;
    setBusy(true);
    reset();
    const code = await requestPasswordSignIn(apiUrl, email, password);
    setBusy(false);
    if (code === 'ok') {
      router.replace('/me');
      return;
    }
    setError(
      code === 'email_not_confirmed'
        ? t('publicApp.login.errors.emailNotConfirmed')
        : t('publicApp.login.errors.passwordLoginFailed'),
    );
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
    const code = await requestSignUp(apiUrl, email, password);
    setBusy(false);
    if (code === 'ok') {
      setMessage(t('publicApp.login.signupCheckEmail', { email: email.trim() }));
      return;
    }
    setError(
      code === 'signups_disabled'
        ? t('publicApp.login.errors.signupsDisabled')
        : code === 'legal_stale'
          ? t('legal.accept.stale')
          : t('publicApp.login.errors.signupFailed'),
    );
  }

  async function handleSendMagicLink() {
    if (!email.trim() || busy) return;
    setBusy(true);
    reset();
    const sent = await requestMagicLink(apiUrl, email);
    setBusy(false);
    if (sent) setMessage(t('publicApp.login.checkEmail'));
    else setError(t('publicApp.login.errors.magicLinkFailed'));
  }

  async function handleResetRequest() {
    if (!email.trim() || busy) return;
    setBusy(true);
    reset();
    await requestPasswordReset(apiUrl, email);
    setBusy(false);
    // The same notice whether or not the address exists — the endpoint does not
    // enumerate accounts, and neither does this.
    setMessage(t('publicApp.login.resetCheckEmail'));
  }

  async function continueWithGoogle() {
    reset();
    const started = await startGoogleSignIn(window.location.origin);
    if (!started) setError(t('auth.oauth.errors.startFailed'));
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
          // The app's one back affordance rather than muted text: sitting under
          // a hairline below two full-width buttons, a bare link did not read
          // as clickable at all. Every token BackLink uses is redefined under
          // the panel's data-theme="dark", so the pill reads correctly here.
          <BackLink href="/" label={t('publicApp.login.backToEvents')} />
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
          {/* Both halves follow the tab: an organizer who is signing in wants
              the other login, one who is creating an account wants the
              organizer signup, which web-admin serves at its own route. */}
          <AuthAltLink
            prompt={
              tab === 'signin'
                ? t('publicApp.login.organizerPrompt')
                : t('publicApp.login.organizerSignupPrompt')
            }
            label={
              tab === 'signin'
                ? t('publicApp.login.organizerLink')
                : t('publicApp.login.organizerSignupLink')
            }
            href={tab === 'signin' ? `${adminUrl}/login` : `${adminUrl}/signup`}
          />
        </>
      )}

      <AuthField
        id="email"
        type="email"
        autoComplete="email"
        label={t('auth.login.emailAddress')}
        placeholder={t('auth.login.emailPlaceholder')}
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />

      {(tab === 'signin' || tab === 'signup') && (
        <AuthField
          id="password"
          type="password"
          autoComplete={tab === 'signup' ? 'new-password' : 'current-password'}
          label={t('auth.login.password')}
          placeholder={t('auth.login.passwordPlaceholder')}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      )}

      {tab === 'signup' && (
        <>
          <AuthField
            id="passwordConfirm"
            type="password"
            autoComplete="new-password"
            label={t('publicApp.login.passwordConfirmLabel')}
            value={passwordConfirm}
            onChange={(event) => setPasswordConfirm(event.target.value)}
          />
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
