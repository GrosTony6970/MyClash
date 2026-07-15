'use client';

import Image from 'next/image';
import { useState } from 'react';
import { useI18n } from '../../src/i18n/I18nProvider';
import { LanguageSwitcher } from '../../src/i18n/LanguageSwitcher';
import { api } from '../../src/lib/api';

export default function ScoringLoginPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [eventSlugOrCode, setEventSlugOrCode] = useState('');
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [staffLoading, setStaffLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // ApiClientError carries the problem+json detail in its message.
      await api.post('/api/v1/auth/magic-link', {
        email,
        type: 'login',
        redirectTo: '/lices',
      });

      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  async function handleStaffSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStaffLoading(true);
    setStaffError(null);

    try {
      await api.post('/api/v1/staff-auth/login', { eventSlugOrCode, username, pin });
      window.location.href = '/lices';
    } catch {
      setStaffError(t('scoring.login.localLoginError'));
    } finally {
      setStaffLoading(false);
    }
  }

  if (submitted) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-8">
        <div className="w-full max-w-sm text-center">
          <Image
            src="/brand/Logomini_nobackground.png"
            alt={t('metadata.scoringTitle')}
            width={80}
            height={80}
            priority
            className="mx-auto mb-6 h-20 w-20"
          />
          <h1 className="text-2xl font-bold mb-4">{t('scoring.login.checkEmailTitle')}</h1>
          <p className="text-muted">
            {t('scoring.login.checkEmailPrefix')}{' '}
            <strong className="text-foreground">{email}</strong>.{' '}
            {t('scoring.login.checkEmailSuffix')}
          </p>
          <p className="mt-4 text-sm text-muted">{t('scoring.login.linkExpires')}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-sm">
        <div className="mb-4 flex justify-end">
          <LanguageSwitcher />
        </div>
        <div className="text-center mb-8">
          <Image
            src="/brand/Logomini_nobackground.png"
            alt={t('metadata.scoringTitle')}
            width={80}
            height={80}
            priority
            className="mx-auto mb-3 h-20 w-20"
          />
          <h1 className="text-2xl font-bold">{t('scoring.login.title')}</h1>
          <p className="text-muted text-sm mt-1">{t('scoring.login.scorekeeperAccess')}</p>
        </div>

        <form
          onSubmit={(e) => {
            void handleStaffSubmit(e);
          }}
          className="mb-8 flex flex-col gap-4 rounded-xl border border-border bg-surface/60 p-4"
        >
          <h2 className="text-sm font-bold uppercase tracking-wide text-muted">
            {t('scoring.login.localStaffAccess')}
          </h2>
          <div>
            <label
              htmlFor="eventSlugOrCode"
              className="block text-sm font-medium text-foreground-secondary mb-1"
            >
              {t('scoring.login.eventIdentifier')}
            </label>
            <input
              id="eventSlugOrCode"
              required
              value={eventSlugOrCode}
              onChange={(e) => setEventSlugOrCode(e.target.value)}
              placeholder={t('scoring.login.eventIdentifierPlaceholder')}
              className="w-full bg-surface border border-border rounded-lg px-4 py-3 text-foreground placeholder-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
            />
          </div>
          <div>
            <label
              htmlFor="staffUsername"
              className="block text-sm font-medium text-foreground-secondary mb-1"
            >
              {t('scoring.login.username')}
            </label>
            <input
              id="staffUsername"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-surface border border-border rounded-lg px-4 py-3 text-foreground placeholder-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
            />
          </div>
          <div>
            <label
              htmlFor="staffPin"
              className="block text-sm font-medium text-foreground-secondary mb-1"
            >
              {t('scoring.login.pin')}
            </label>
            <input
              id="staffPin"
              type="password"
              inputMode="numeric"
              required
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className="w-full bg-surface border border-border rounded-lg px-4 py-3 text-foreground placeholder-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
            />
          </div>
          {staffError && (
            <p className="text-sm text-danger" role="alert">
              {staffError}
            </p>
          )}
          <button
            type="submit"
            disabled={staffLoading}
            className="w-full bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-foreground font-bold py-3 px-4 rounded-lg transition-colors text-lg"
          >
            {staffLoading ? t('scoring.login.signingIn') : t('scoring.login.signInWithPin')}
          </button>
        </form>

        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="flex flex-col gap-4"
        >
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-foreground-secondary mb-1"
            >
              {t('scoring.login.emailAddress')}
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('scoring.login.emailPlaceholder')}
              className="w-full bg-surface border border-border rounded-lg px-4 py-3 text-foreground placeholder-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
            />
          </div>

          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-foreground font-bold py-3 px-4 rounded-lg transition-colors text-lg"
          >
            {loading ? t('scoring.login.sending') : t('scoring.login.sendLoginLink')}
          </button>
        </form>
      </div>
    </main>
  );
}
