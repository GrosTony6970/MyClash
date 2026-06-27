'use client';

import { useEffect, useState } from 'react';
import { getApiUrl } from '@/lib/api-url';
import { useI18n } from '../../../../../src/i18n/I18nProvider';

interface Props {
  params: Promise<{ eventSlug: string }>;
}

interface MeResponse {
  type: 'claimed' | 'guest' | 'anonymous';
  user?: {
    email?: string;
  };
}

interface PendingEmailChange {
  newEmail: string;
  expiresAt: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EmailChangePage({ params }: Props) {
  const { t } = useI18n();
  const [eventSlug, setEventSlug] = useState<string | null>(null);
  const [currentEmail, setCurrentEmail] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [pending, setPending] = useState<PendingEmailChange | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const apiUrl = getApiUrl();

  useEffect(() => {
    void params.then(({ eventSlug: slug }) => setEventSlug(slug));
  }, [params]);

  useEffect(() => {
    let cancelled = false;

    fetch(`${apiUrl}/api/v1/me`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error('me');
        return (await res.json()) as MeResponse;
      })
      .then((me) => {
        if (cancelled) return;
        if (me.type !== 'claimed' || !me.user?.email) {
          setError(t('publicApp.emailChange.accessRequired'));
          setCurrentEmail('');
          return;
        }
        setCurrentEmail(me.user.email);
      })
      .then(() =>
        fetch(`${apiUrl}/api/v1/persons/me/email-change`, { credentials: 'include' }).then(
          async (res) => {
            if (!res.ok) return null;
            return (await res.json()) as PendingEmailChange | null;
          },
        ),
      )
      .then((pendingResponse) => {
        if (!cancelled && pendingResponse) setPending(pendingResponse);
      })
      .catch(() => {
        if (!cancelled) setError(t('publicApp.emailChange.loadError'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [apiUrl, t]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = newEmail.trim().toLowerCase();
    setMessage(null);
    setError(null);

    if (!EMAIL_RE.test(normalized)) {
      setError(t('publicApp.emailChange.invalidEmail'));
      return;
    }
    if (normalized === currentEmail.trim().toLowerCase()) {
      setError(t('publicApp.emailChange.sameEmail'));
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/persons/me/email-change`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ newEmail: normalized }),
      });
      if (!res.ok) throw new Error('request');
      const body = (await res.json()) as PendingEmailChange;
      setPending(body);
      setNewEmail('');
      setMessage(t('publicApp.emailChange.requestSuccess'));
    } catch {
      setError(t('publicApp.emailChange.requestError'));
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel() {
    setMessage(null);
    setError(null);
    setCancelling(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/persons/me/email-change`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('cancel');
      setPending(null);
      setMessage(t('publicApp.emailChange.cancelSuccess'));
    } catch {
      setError(t('publicApp.emailChange.cancelError'));
    } finally {
      setCancelling(false);
    }
  }

  return (
    <main id="main-content" className="min-h-screen bg-gray-950 px-4 py-8 text-white">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">
        <header>
          <p className="text-sm text-gray-400">{eventSlug ?? ''}</p>
          <h1 className="mt-2 font-display font-bold text-2xl sm:text-3xl">
            {t('publicApp.emailChange.title')}
          </h1>
          <p className="mt-2 text-sm text-gray-400">{t('publicApp.emailChange.description')}</p>
        </header>

        {loading ? (
          <p className="text-sm text-gray-400">{t('common.loading')}</p>
        ) : (
          <>
            <section className="rounded-lg border border-gray-800 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                {t('publicApp.emailChange.currentEmail')}
              </p>
              <p className="mt-1 break-all text-sm font-semibold text-gray-100">
                {currentEmail || t('common.unknown')}
              </p>
            </section>

            {pending && (
              <section className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
                <h2 className="text-sm font-semibold text-amber-100">
                  {t('publicApp.emailChange.pendingTitle')}
                </h2>
                <p className="mt-2 text-sm text-amber-100">
                  {t('publicApp.emailChange.pendingDescription', { email: pending.newEmail })}
                </p>
                <p className="mt-1 text-xs text-amber-200">
                  {t('publicApp.emailChange.expiresAt', { date: pending.expiresAt })}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    void handleCancel();
                  }}
                  disabled={cancelling}
                  className="mt-4 w-full rounded-md border border-amber-300/50 px-4 py-2 text-sm font-semibold text-amber-50 disabled:opacity-50"
                >
                  {cancelling
                    ? t('publicApp.emailChange.cancelling')
                    : t('publicApp.emailChange.cancelPending')}
                </button>
              </section>
            )}

            <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
              <label htmlFor="new-email" className="block text-sm font-medium text-gray-200">
                {t('publicApp.emailChange.newEmail')}
                <input
                  id="new-email"
                  type="email"
                  required
                  aria-label={t('publicApp.emailChange.newEmail')}
                  autoComplete="email"
                  value={newEmail}
                  onChange={(event) => setNewEmail(event.target.value)}
                  placeholder={t('publicApp.emailChange.newEmailPlaceholder')}
                  className="mt-2 w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-3 text-sm text-white outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
                />
              </label>

              {message && (
                <p className="rounded-md border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-100">
                  {message}
                </p>
              )}
              {error && (
                <p
                  role="alert"
                  className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-100"
                >
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={saving || !currentEmail}
                className="rounded-md bg-red-700 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-red-800 disabled:opacity-50"
              >
                {saving
                  ? t('publicApp.emailChange.sending')
                  : t('publicApp.emailChange.sendConfirmation')}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
