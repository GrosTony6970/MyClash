'use client';

import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';
import { AuthAltLink, AuthNotice, AuthPanel } from '@myclash/ui';
import type { AuthPanelTab } from '@myclash/ui';
import { savePendingOrganizerSignup } from '../../src/components/OAuthCallback';
import { useI18n } from '@myclash/next-i18n/client';
import { currentLegalVersionFields } from '../../src/lib/legal-url';
import { createOAuthSupabaseClient } from '../../src/lib/oauth-supabase';
import { resolvePostAuthDestination } from '../../src/lib/post-auth-destination';
import { apiRequest, failureCode, failureMessage } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import {
  validateAccountStep,
  validateOrgStep,
  type AuthFormCode,
  type SignupIntent,
} from './auth-form-state';
import { AlternativeMethods, ResetForm, SignInForm, type LoadingAction } from './signin-forms';
import {
  AccountStepForm,
  OrgStepForm,
  SignupDone,
  type AccountDraft,
  type SlugStatus,
} from './signup-forms';

export type AuthTab = 'signin' | 'signup' | 'reset';
type LoginResponse = { next?: string };

/**
 * Validation codes carry no copy, so that the i18n reverse sweep still sees a
 * literal key at every callsite. This is the one place the two meet.
 */
const CODE_KEYS: Record<AuthFormCode, string> = {
  legal_required: 'legal.accept.required',
  email_invalid: 'admin.common.validEmailRequired',
  display_name_required: 'admin.common.displayNameRequired',
  password_weak: 'admin.common.passwordMinLength',
  password_mismatch: 'admin.common.passwordsDoNotMatch',
  org_name_required: 'admin.common.orgNameRequired',
  slug_too_short: 'admin.common.slugMinLength',
  slug_unavailable: 'admin.common.chooseDifferentSlug',
};

const EMPTY_DRAFT: AccountDraft = {
  email: '',
  displayName: '',
  password: '',
  passwordConfirm: '',
  acceptedLegal: false,
};

/**
 * The organizer front door: sign in, create an organizer account, reset a
 * password — one page, one panel, the same shell the fighter app uses.
 *
 * `/login` and `/signup` both render this with a different `initialTab`. The
 * tab is a prop rather than a query parameter read through `useSearchParams`,
 * which would opt the whole component out of the React Compiler, and rather
 * than a `window.location` read in a state initializer, which would not match
 * what the server rendered.
 */
export function AuthPage({ initialTab }: { initialTab: AuthTab }) {
  const { t } = useI18n();
  const apiUrl = getPublicApiUrl();
  const publicAppUrl = process.env['NEXT_PUBLIC_PUBLIC_APP_URL'] ?? 'https://app.myclash.fr';

  const [tab, setTab] = useState<AuthTab>(initialTab);
  // One draft across the tabs on purpose: someone who tried to sign in and
  // switches to creating an account has already typed their address.
  const [draft, setDraft] = useState<AccountDraft>(EMPTY_DRAFT);

  const [step, setStep] = useState<1 | 2>(1);
  const [intent, setIntent] = useState<SignupIntent>('password');
  const [orgName, setOrgName] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [slugStatus, setSlugStatus] = useState<SlugStatus>({ checking: false, available: null });
  const [done, setDone] = useState<{ intent: SignupIntent; orgSlug: string } | null>(null);

  const [loadingAction, setLoadingAction] = useState<LoadingAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loading = loadingAction !== null;
  const email = draft.email;

  function clearBanners() {
    setError(null);
    setMessage(null);
  }

  function switchTab(next: AuthTab) {
    setTab(next);
    setStep(1);
    setDone(null);
    clearBanners();
  }

  function fail(code: AuthFormCode): void {
    setError(t(CODE_KEYS[code]));
  }

  // ── Sign in ───────────────────────────────────────────────────────────────

  async function handlePasswordLogin(event: React.FormEvent) {
    event.preventDefault();
    setLoadingAction('password');
    clearBanners();
    const r = await apiRequest<LoginResponse>(apiUrl, '/api/v1/auth/password-login', {
      method: 'POST',
      body: { email, password: draft.password, redirectTo: '/dashboard' },
    });
    if (!r.ok) {
      // A 503 here is the maintenance lockdown, and the screen's own sentence
      // names it. Expressed as the FALLBACK so an `OperationalUnavailable`
      // 503 — the one 5xx the filter leaves unscrubbed — still wins with its
      // own words. The throttle sentence comes from the seam.
      const fallback =
        r.kind === 'http' && r.status === 503
          ? t('admin.featureFlags.lockdownBanner')
          : t('auth.login.errors.passwordLoginFailed');
      const message = failureMessage(r, t, fallback);
      if (message) setError(message);
      setLoadingAction(null);
      return;
    }
    // If the server picked a specific `next`, honour it; otherwise auto-route
    // organizers straight into their primary org's auto-selected event.
    window.location.href = r.data.next ?? (await resolvePostAuthDestination('/dashboard'));
  }

  async function handleMagicLink() {
    if (!email.trim() || loading) return;
    setLoadingAction('magic_link');
    clearBanners();
    try {
      const r = await apiRequest(apiUrl, '/api/v1/auth/magic-link', {
        method: 'POST',
        body: { email: email.trim(), type: 'login', redirectTo: '/dashboard' },
      });
      if (!r.ok) {
        // The throttle is the refusal an operator actually meets here — three
        // links an hour per address — and the seam says to wait, in French too.
        const message = failureMessage(r, t, t('auth.login.errors.magicLinkFailed'));
        if (message) setError(message);
        return;
      }
      setMessage(t('auth.login.checkEmail', { email: email.trim() }));
    } finally {
      setLoadingAction(null);
    }
  }

  async function startGoogle(redirectTo: string) {
    const { error: oauthError } = await createOAuthSupabaseClient().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
    if (oauthError) {
      setError(t('auth.oauth.errors.startFailed'));
      setLoadingAction(null);
    }
  }

  async function handleGoogleLogin() {
    setLoadingAction('google');
    clearBanners();
    const next = encodeURIComponent('/dashboard');
    await startGoogle(`${window.location.origin}/auth/oauth/callback?next=${next}`);
  }

  /**
   * Request a password-recovery email.
   *
   * Reuses the PUBLIC endpoint unchanged, including its no-enumeration
   * behaviour: it answers the same way whether or not the address exists. So
   * does this, which is why the notice is shown even when the request fails.
   */
  async function handleResetRequest(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim() || loading) return;
    setLoadingAction('reset');
    clearBanners();
    try {
      // The outcome is deliberately ignored — see above. Telling the caller
      // whether the address exists is exactly what this endpoint must not do,
      // so the same "check your email" line is shown either way.
      await apiRequest(apiUrl, '/api/v1/auth/public-password-reset', {
        method: 'POST',
        // `type` picks the host the recovery link opens. Without it the server
        // defaults to the participant app and an organizer finishes the reset
        // on a domain they never asked about.
        body: { email: email.trim(), type: 'login' },
      });
    } finally {
      setMessage(t('auth.login.resetCheckEmail'));
      setLoadingAction(null);
    }
  }

  // ── Signup ────────────────────────────────────────────────────────────────

  /**
   * Every intent lands on the organization step first. Unlike the fighter
   * signup, none of the three can fire from the account step: an organizer
   * account owns an organization, and its name and slug are part of the create
   * request whichever credential is chosen.
   */
  function goToOrgStep(next: SignupIntent) {
    const code = validateAccountStep({ intent: next, ...draft });
    if (code) {
      fail(code);
      return;
    }
    setIntent(next);
    clearBanners();
    setStep(2);
  }

  const checkSlug = useCallback(
    async (slug: string) => {
      if (!slug || slug.length < 3) {
        setSlugStatus({ checking: false, available: null });
        return;
      }
      setSlugStatus({ checking: true, available: null });
      // The one call in this file that gains credentials it did not send. It
      // probes a slug BEFORE any account exists, so the cookie is simply
      // irrelevant here — harmless, unlike the two picker reads where the same
      // omission made the API refuse the caller outright.
      const r = await apiRequest<{ available: boolean; reason?: 'reserved' | 'taken' }>(
        apiUrl,
        `/api/v1/auth/check-slug?slug=${encodeURIComponent(slug)}`,
      );
      // `available: null` is the third state the hint renders as "checking
      // failed" — a refusal must not read as "this slug is free".
      setSlugStatus(
        r.ok
          ? { checking: false, available: r.data.available, reason: r.data.reason }
          : { checking: false, available: null },
      );
    },
    [apiUrl],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      void checkSlug(orgSlug);
    }, 300);
    return () => clearTimeout(timer);
  }, [orgSlug, checkSlug]);

  async function handleCreateAccount(event: React.FormEvent) {
    event.preventDefault();
    const code = validateOrgStep({ orgName, orgSlug, slugAvailable: slugStatus.available });
    if (code) {
      fail(code);
      return;
    }
    clearBanners();

    if (intent === 'google') {
      setLoadingAction('google');
      // Handed to the callback through sessionStorage: the OAuth round trip
      // cannot carry a body, and the organization is part of the create.
      savePendingOrganizerSignup({
        orgName: orgName.trim(),
        orgSlug,
        ...currentLegalVersionFields(),
      });
      const next = encodeURIComponent(`/org/${orgSlug}`);
      await startGoogle(`${window.location.origin}/signup/oauth/callback?next=${next}`);
      return;
    }

    setLoadingAction('signup');
    try {
      const body: Record<string, string> = {
        email,
        displayName: draft.displayName.trim(),
        method: intent,
        orgName: orgName.trim(),
        orgSlug,
        // The versions this bundle displayed. The server compares them to what
        // is published and refuses a stale pair, so a tab left open across a
        // policy revision cannot record consent to the old text.
        ...currentLegalVersionFields(),
      };
      if (intent === 'password') body['password'] = draft.password;

      const r = await apiRequest(apiUrl, '/api/v1/auth/signup', { method: 'POST', body });
      if (!r.ok) {
        // The policy moved on while this tab was open. Say so in the user's
        // language rather than passing through the server's English sentence.
        //
        // Read through `failureCode` and NOT `detail`: this one is thrown as an
        // explicit `code:`, which `normalizeCode` passes through verbatim — the
        // mirror image of the `email_in_use` rule on the fighters console,
        // where the marker lives in `detail` instead.
        const message =
          failureCode(r) === 'legal_version_stale'
            ? t('legal.accept.stale')
            : failureMessage(r, t, t('admin.common.signupFailed'));
        if (message) setError(message);
        return;
      }
      setDone({ intent, orgSlug });
    } finally {
      setLoadingAction(null);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const tabs: ReadonlyArray<AuthPanelTab<AuthTab>> = [
    { value: 'signin', label: t('auth.login.tabSignIn') },
    { value: 'signup', label: t('auth.login.tabSignUp') },
  ];

  const heading =
    tab === 'signin'
      ? { title: t('auth.login.formTitle'), description: t('auth.login.formDescription') }
      : tab === 'reset'
        ? { title: t('auth.login.resetTitle'), description: t('auth.login.resetDescription') }
        : {
            title: t('auth.signup.title'),
            description: step === 1 ? t('auth.signup.step1Label') : t('auth.signup.step2Label'),
          };

  return (
    <AuthPanel<AuthTab>
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
      tabs={tabs}
      activeTab={tab}
      onTabChange={switchTab}
      tabsLabel={t('auth.login.tabsLabel')}
      footer={
        tab === 'reset' ? (
          <button
            type="button"
            onClick={() => switchTab('signin')}
            className="text-sm font-semibold text-muted hover:text-foreground"
          >
            {t('auth.login.backToSignIn')}
          </button>
        ) : undefined
      }
    >
      {done ? (
        <SignupDone t={t} intent={done.intent} email={email} orgSlug={done.orgSlug} />
      ) : (
        <>
          <h2 className="text-2xl font-black">{heading.title}</h2>
          <p className="text-sm leading-6 text-muted">{heading.description}</p>

          {/* `/login` on both tabs: the participant page's signup tab is
              useState, not a route, so there is nothing to deep-link to — and
              giving it one through useSearchParams would opt that page out of
              the React Compiler, which is why its own tab is a prop. */}
          {tab !== 'reset' && step === 1 && (
            <AuthAltLink
              prompt={t('auth.login.participantPrompt')}
              label={t('auth.login.participantLink')}
              href={`${publicAppUrl}/login`}
            />
          )}

          {tab === 'signin' && (
            <SignInForm
              t={t}
              email={email}
              password={draft.password}
              onEmail={(value) => setDraft((current) => ({ ...current, email: value }))}
              onPassword={(value) => setDraft((current) => ({ ...current, password: value }))}
              loadingAction={loadingAction}
              onSubmit={(event) => void handlePasswordLogin(event)}
              onForgotPassword={() => switchTab('reset')}
            />
          )}

          {tab === 'reset' && (
            <ResetForm
              t={t}
              email={email}
              onEmail={(value) => setDraft((current) => ({ ...current, email: value }))}
              loadingAction={loadingAction}
              onSubmit={(event) => void handleResetRequest(event)}
            />
          )}

          {tab === 'signup' && step === 1 && (
            <AccountStepForm
              t={t}
              draft={draft}
              onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
              disabled={loading}
              onSubmit={(event) => {
                event.preventDefault();
                goToOrgStep('password');
              }}
            />
          )}

          {tab === 'signup' && step === 2 && (
            <OrgStepForm
              t={t}
              orgName={orgName}
              orgSlug={orgSlug}
              slugStatus={slugStatus}
              intent={intent}
              loadingAction={loadingAction}
              onOrgName={(name, slug) => {
                setOrgName(name);
                setOrgSlug(slug);
              }}
              onOrgSlug={setOrgSlug}
              onBack={() => {
                setStep(1);
                clearBanners();
              }}
              onSubmit={(event) => void handleCreateAccount(event)}
            />
          )}

          {tab !== 'reset' && step === 1 && (
            <AlternativeMethods
              t={t}
              mode={tab}
              email={email}
              loadingAction={loadingAction}
              onMagicLink={() => {
                if (tab === 'signin') void handleMagicLink();
                else goToOrgStep('magic_link');
              }}
              onGoogle={() => {
                if (tab === 'signin') void handleGoogleLogin();
                else goToOrgStep('google');
              }}
            />
          )}

          {message && <AuthNotice tone="success">{message}</AuthNotice>}
          {error && <AuthNotice tone="error">{error}</AuthNotice>}
        </>
      )}
    </AuthPanel>
  );
}
