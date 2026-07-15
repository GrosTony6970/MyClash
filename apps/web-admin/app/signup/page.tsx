'use client';

import { useCallback, useEffect, useState } from 'react';
import { GoogleIcon } from '@myclash/ui';
import { savePendingOrganizerSignup } from '../../src/components/OAuthCallback';
import { useI18n } from '../../src/i18n/I18nProvider';
import { createOAuthSupabaseClient } from '../../src/lib/oauth-supabase';

// ── Types ──────────────────────────────────────────────────────────────────

type Method = 'magic_link' | 'password' | 'google';
type Step = 1 | 2;

interface SlugStatus {
  checking: boolean;
  available: boolean | null;
  reason?: 'reserved' | 'taken';
}

// ── Helpers ────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

// ── Component ──────────────────────────────────────────────────────────────

export default function SignupPage() {
  const { t } = useI18n();
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  // Step 1 state
  const [step, setStep] = useState<Step>(1);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [method, setMethod] = useState<Method>('magic_link');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');

  // Step 2 state
  const [orgName, setOrgName] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [slugStatus, setSlugStatus] = useState<SlugStatus>({
    checking: false,
    available: null,
  });

  // Submission state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ type: Method; orgSlug: string } | null>(null);

  // ── Auto-suggest slug from org name ──────────────────────────────────────
  // Derived state: computed directly in the onChange handler, no useEffect needed

  // ── Real-time slug check (debounced 300ms) ────────────────────────────────

  const checkSlug = useCallback(
    async (slug: string) => {
      if (!slug || slug.length < 3) {
        setSlugStatus({ checking: false, available: null });
        return;
      }
      setSlugStatus({ checking: true, available: null });
      try {
        const res = await fetch(
          `${apiUrl}/api/v1/auth/check-slug?slug=${encodeURIComponent(slug)}`,
        );
        const data = (await res.json()) as { available: boolean; reason?: 'reserved' | 'taken' };
        setSlugStatus({ checking: false, available: data.available, reason: data.reason });
      } catch {
        setSlugStatus({ checking: false, available: null });
      }
    },
    [apiUrl],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      void checkSlug(orgSlug);
    }, 300);
    return () => clearTimeout(timer);
  }, [orgSlug, checkSlug]);

  // ── Step 1 validation ─────────────────────────────────────────────────────

  function validateStep1(): string | null {
    if (method === 'google') return null;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return t('admin.common.validEmailRequired');
    if (!displayName || displayName.trim().length < 2) return t('admin.common.displayNameRequired');
    if (method === 'password') {
      if (password.length < 8) return t('admin.common.passwordMinLength');
      if (password !== passwordConfirm) return t('admin.common.passwordsDoNotMatch');
    }
    return null;
  }

  async function handleGoogleSignup() {
    if (!orgName.trim()) {
      setError(t('admin.common.orgNameRequired'));
      return;
    }
    if (!orgSlug || orgSlug.length < 3) {
      setError(t('admin.common.slugMinLength'));
      return;
    }
    if (slugStatus.available === false) {
      setError(t('admin.common.chooseDifferentSlug'));
      return;
    }

    setError(null);
    setLoading(true);
    savePendingOrganizerSignup({ orgName: orgName.trim(), orgSlug });
    const next = `/org/${orgSlug}`;
    const redirectTo = `${window.location.origin}/signup/oauth/callback?next=${encodeURIComponent(next)}`;
    const { error: oauthError } = await createOAuthSupabaseClient().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
    if (oauthError) {
      setError(t('auth.oauth.errors.startFailed'));
      setLoading(false);
    }
  }

  function handleStep1(e: React.FormEvent) {
    e.preventDefault();
    const err = validateStep1();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setStep(2);
  }

  // ── Step 2 submission ─────────────────────────────────────────────────────

  async function handleStep2(e: React.FormEvent) {
    e.preventDefault();
    if (!orgName.trim()) {
      setError(t('admin.common.orgNameRequired'));
      return;
    }
    if (!orgSlug || orgSlug.length < 3) {
      setError(t('admin.common.slugMinLength'));
      return;
    }
    if (slugStatus.available === false) {
      setError(t('admin.common.chooseDifferentSlug'));
      return;
    }
    setError(null);
    setLoading(true);

    try {
      const body: Record<string, string> = {
        email,
        displayName: displayName.trim(),
        method,
        orgName: orgName.trim(),
        orgSlug,
      };
      if (method === 'password') body['password'] = password;

      const res = await fetch(`${apiUrl}/api/v1/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = (await res.json()) as { message?: string };
        throw new Error(data.message ?? t('admin.common.signupFailed'));
      }

      setDone({ type: method, orgSlug });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.common.somethingWentWrong'));
    } finally {
      setLoading(false);
    }
  }

  // ── Success screen ────────────────────────────────────────────────────────

  if (done) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-8">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-2xl font-bold mb-4">
            {done.type === 'magic_link'
              ? t('auth.signup.doneMagicTitle')
              : t('auth.signup.doneVerifyTitle')}
          </h1>
          {done.type === 'magic_link' ? (
            <p className="text-foreground-secondary">
              {t('auth.signup.doneMagicPrefix')} <strong>{email}</strong>.{' '}
              {t('auth.signup.doneMagicSuffix')}
            </p>
          ) : (
            <>
              <p className="text-foreground-secondary">{t('auth.signup.doneVerifyCreated')}</p>
              <p className="mt-3 text-foreground-secondary">
                {t('auth.signup.doneVerifyPrefix')} <strong>{email}</strong>.
              </p>
              <a
                href={`/org/${done.orgSlug}`}
                className="mt-6 inline-block text-accent hover:underline text-sm"
              >
                {t('auth.signup.goToDashboard')}
              </a>
            </>
          )}
        </div>
      </main>
    );
  }

  // ── Form ──────────────────────────────────────────────────────────────────

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-1">{t('auth.signup.title')}</h1>
        <p className="text-muted text-sm mb-6">
          {step === 1 ? t('auth.signup.step1Label') : t('auth.signup.step2Label')}
        </p>

        {/* ── Step 1: Account ── */}
        {step === 1 && (
          <form onSubmit={handleStep1} className="flex flex-col gap-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-1">
                {t('auth.signup.emailLabel')}
              </label>
              <input
                id="email"
                type="email"
                required={method !== 'google'}
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('auth.login.emailPlaceholder')}
                className="w-full border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>

            <div>
              <label htmlFor="displayName" className="block text-sm font-medium mb-1">
                {t('auth.signup.displayNameLabel')}
              </label>
              <input
                id="displayName"
                type="text"
                required={method !== 'google'}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t('auth.signup.displayNamePlaceholder')}
                className="w-full border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMethod('magic_link')}
                className={`flex-1 py-2 px-3 rounded-md text-sm font-medium border transition-colors ${
                  method === 'magic_link'
                    ? 'bg-accent text-accent-foreground border-accent'
                    : 'bg-surface text-foreground-secondary border-border hover:border-accent'
                }`}
              >
                {t('auth.signup.methodMagicLink')}
              </button>
              <button
                type="button"
                onClick={() => setMethod('password')}
                className={`flex-1 py-2 px-3 rounded-md text-sm font-medium border transition-colors ${
                  method === 'password'
                    ? 'bg-accent text-accent-foreground border-accent'
                    : 'bg-surface text-foreground-secondary border-border hover:border-accent'
                }`}
              >
                {t('auth.signup.methodPassword')}
              </button>
              <button
                type="button"
                onClick={() => setMethod('google')}
                className={`flex-1 py-2 px-3 rounded-md text-sm font-medium border transition-colors ${
                  method === 'google'
                    ? 'bg-accent text-accent-foreground border-accent'
                    : 'bg-surface text-foreground-secondary border-border hover:border-accent'
                }`}
              >
                {t('auth.oauth.google')}
              </button>
            </div>

            {method === 'password' && (
              <>
                <div>
                  <label htmlFor="password" className="block text-sm font-medium mb-1">
                    {t('auth.signup.passwordLabel')}
                  </label>
                  <input
                    id="password"
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('auth.signup.passwordPlaceholder')}
                    className="w-full border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>
                <div>
                  <label htmlFor="passwordConfirm" className="block text-sm font-medium mb-1">
                    {t('auth.signup.passwordConfirmLabel')}
                  </label>
                  <input
                    id="passwordConfirm"
                    type="password"
                    required
                    value={passwordConfirm}
                    onChange={(e) => setPasswordConfirm(e.target.value)}
                    placeholder={t('auth.signup.passwordConfirmPlaceholder')}
                    className="w-full border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>
              </>
            )}

            {error && (
              <p className="text-sm text-danger" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              className="w-full bg-accent hover:bg-accent-hover text-accent-foreground font-semibold py-2 px-4 rounded-md transition-colors"
            >
              {t('auth.signup.continue')}
            </button>

            <p className="text-center text-sm text-muted">
              {t('auth.signup.alreadyHaveAccount')}{' '}
              <a href="/login" className="text-accent hover:underline">
                {t('auth.signup.logIn')}
              </a>
            </p>
          </form>
        )}

        {/* ── Step 2: Organization ── */}
        {step === 2 && (
          <form
            onSubmit={(e) => {
              if (method === 'google') {
                e.preventDefault();
                void handleGoogleSignup();
              } else {
                void handleStep2(e);
              }
            }}
            className="flex flex-col gap-4"
          >
            <div>
              <label htmlFor="orgName" className="block text-sm font-medium mb-1">
                {t('auth.signup.orgNameLabel')}
              </label>
              <input
                id="orgName"
                type="text"
                required
                value={orgName}
                onChange={(e) => {
                  setOrgName(e.target.value);
                  setOrgSlug(slugify(e.target.value));
                }}
                placeholder={t('auth.signup.orgNamePlaceholder')}
                className="w-full border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <p className="text-xs text-muted mt-1">{t('auth.signup.orgNameHint')}</p>
            </div>

            <div>
              <label htmlFor="orgSlug" className="block text-sm font-medium mb-1">
                {t('auth.signup.slugLabel')}
                {slugStatus.checking && (
                  <span className="ml-2 text-xs text-muted">{t('auth.signup.slugChecking')}</span>
                )}
                {!slugStatus.checking && slugStatus.available === true && (
                  <span className="ml-2 text-xs text-success">
                    {t('auth.signup.slugAvailable')}
                  </span>
                )}
                {!slugStatus.checking && slugStatus.available === false && (
                  <span className="ml-2 text-xs text-danger">
                    ✗{' '}
                    {slugStatus.reason === 'reserved'
                      ? t('auth.signup.slugReserved')
                      : t('auth.signup.slugTaken')}
                  </span>
                )}
              </label>
              <div className="flex items-center border border-border rounded-md overflow-hidden focus-within:ring-2 focus-within:ring-accent">
                <span className="px-3 py-2 bg-background text-muted text-sm border-r border-border select-none">
                  {'admin.myclash.fr/org/'}
                </span>
                <input
                  id="orgSlug"
                  type="text"
                  required
                  value={orgSlug}
                  onChange={(e) =>
                    setOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
                  }
                  placeholder={t('auth.signup.slugPlaceholder')}
                  className="flex-1 px-3 py-2 text-sm focus:outline-none"
                />
              </div>
              <p className="text-xs text-muted mt-1">{t('auth.signup.slugHint')}</p>
            </div>

            {error && (
              <p className="text-sm text-danger" role="alert">
                {error}
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setStep(1);
                  setError(null);
                }}
                className="flex-1 py-2 px-4 rounded-md text-sm font-medium border border-border text-foreground-secondary hover:border-muted transition-colors"
              >
                {t('auth.signup.back')}
              </button>
              <button
                type="submit"
                disabled={loading || slugStatus.available === false || slugStatus.checking}
                className="flex-1 inline-flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-foreground font-semibold py-2 px-4 rounded-md transition-colors"
              >
                {method === 'google' && <GoogleIcon />}
                {method === 'google'
                  ? t('auth.oauth.continueWithGoogle')
                  : loading
                    ? t('auth.signup.creating')
                    : t('auth.signup.createAccount')}
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
