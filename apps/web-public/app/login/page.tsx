'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { useI18n } from '../../src/i18n/I18nProvider';
import { createOAuthSupabaseClient } from '../../src/lib/oauth-supabase';

export default function PublicLoginPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  async function sendMagicLink() {
    if (!email.trim() || sending) return;
    setSending(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/magic-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: email.trim(),
          type: 'public_login',
          redirectTo: '/me',
        }),
      });

      if (!response.ok) throw new Error('magic-link');
      setMessage(t('publicApp.login.checkEmail'));
    } catch {
      setError(t('publicApp.login.errors.magicLinkFailed'));
    } finally {
      setSending(false);
    }
  }

  async function continueWithGoogle() {
    setError(null);
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
    <main id="main-content" className="min-h-screen bg-[#0f172a] px-4 py-6 text-white sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-5xl items-center justify-center">
        <section className="grid w-full overflow-hidden rounded-lg border border-slate-700 bg-slate-950 shadow-2xl lg:grid-cols-[1fr_420px]">
          <div className="relative hidden min-h-[560px] overflow-hidden bg-[#111827] p-8 lg:block">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(29,78,216,0.35),transparent_34%),radial-gradient(circle_at_80%_10%,rgba(245,158,11,0.24),transparent_26%),linear-gradient(135deg,#0f172a,#111827_55%,#1f2937)]" />
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
                  <p className="font-serif text-xl font-bold">{t('app.name')}</p>
                  <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#f59e0b]">
                    {t('publicApp.login.eyebrow')}
                  </p>
                </div>
              </Link>
              <div>
                <h1 className="max-w-lg text-4xl font-black leading-tight">
                  {t('publicApp.login.title')}
                </h1>
                <p className="mt-4 max-w-md text-sm leading-6 text-slate-300">
                  {t('publicApp.login.subtitle')}
                </p>
              </div>
            </div>
          </div>

          <div className="p-5 sm:p-8">
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <Image src="/brand/Logomini_nobackground.png" alt="" width={44} height={44} />
              <div>
                <p className="font-serif text-lg font-bold">{t('app.name')}</p>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#f59e0b]">
                  {t('publicApp.login.eyebrow')}
                </p>
              </div>
            </div>

            <div className="space-y-5">
              <div>
                <h2 className="text-2xl font-black">{t('publicApp.login.formTitle')}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  {t('publicApp.login.formDescription')}
                </p>
              </div>

              <label className="block">
                <span className="text-sm font-semibold text-slate-200">
                  {t('auth.login.emailAddress')}
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder={t('auth.login.emailPlaceholder')}
                  className="mt-2 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-3 text-white outline-none transition focus:border-[#1d4ed8] focus:ring-2 focus:ring-[#1d4ed8]/30"
                />
              </label>

              <button
                type="button"
                disabled={sending}
                onClick={() => void sendMagicLink()}
                className="w-full rounded-md bg-[#dc2626] px-4 py-3 text-sm font-bold text-white shadow-lg shadow-red-950/30 transition hover:bg-red-700 disabled:cursor-wait disabled:bg-slate-700"
              >
                {sending ? t('auth.login.sending') : t('publicApp.login.sendMagicLink')}
              </button>

              <button
                type="button"
                onClick={() => void continueWithGoogle()}
                className="w-full rounded-md border border-slate-700 px-4 py-3 text-sm font-bold text-slate-100 transition hover:border-[#1d4ed8] hover:bg-[#1d4ed8]/15"
              >
                {t('auth.oauth.continueWithGoogle')}
              </button>

              {message && (
                <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
                  {message}
                </p>
              )}
              {error && (
                <p
                  className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100"
                  role="alert"
                >
                  {error}
                </p>
              )}

              <div className="border-t border-slate-800 pt-5">
                <Link href="/" className="text-sm font-semibold text-slate-300 hover:text-white">
                  {t('publicApp.login.backToEvents')}
                </Link>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
