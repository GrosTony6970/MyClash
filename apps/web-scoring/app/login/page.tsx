'use client';

import Image from 'next/image';
import { useState } from 'react';
import { useI18n } from '../../src/i18n/I18nProvider';

export default function ScoringLoginPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${apiUrl}/api/v1/auth/magic-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email,
          type: 'login',
          redirectTo: '/lices',
        }),
      });

      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? 'Request failed');
      }

      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
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
          <p className="text-gray-400">
            {t('scoring.login.checkEmailPrefix')} <strong className="text-white">{email}</strong>.{' '}
            {t('scoring.login.checkEmailSuffix')}
          </p>
          <p className="mt-4 text-sm text-gray-500">{t('scoring.login.linkExpires')}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-sm">
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
          <p className="text-gray-400 text-sm mt-1">{t('scoring.login.scorekeeperAccess')}</p>
        </div>

        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="flex flex-col gap-4"
        >
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-1">
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
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-600 focus:border-transparent"
            />
          </div>

          {error && (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white font-bold py-3 px-4 rounded-lg transition-colors text-lg"
          >
            {loading ? t('scoring.login.sending') : t('scoring.login.sendLoginLink')}
          </button>
        </form>
      </div>
    </main>
  );
}
