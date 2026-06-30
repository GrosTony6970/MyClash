'use client';

import { useEffect, useState } from 'react';
import { Button } from '@myclash/ui';
import { useI18n } from '@/i18n/I18nProvider';

interface PendingEmailChange {
  newEmail: string;
  expiresAt: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Account-credentials card for /me/security: shows the current email + sign-in
 * method, and hosts the email-change flow (request → pending → cancel) that used
 * to live in the settings AccountSection. Reuses the existing
 * `/api/v1/persons/me/email-change` endpoints and `publicApp.emailChange.*`
 * strings. `email`/`hasPassword` come from the page's `security-status` fetch;
 * the pending request is fetched here.
 */
export function EmailChangeSection({
  apiUrl,
  email,
  hasPassword,
}: {
  apiUrl: string;
  email: string | null;
  hasPassword: boolean;
}) {
  const { t } = useI18n();
  const [pending, setPending] = useState<PendingEmailChange | null>(null);
  const [editing, setEditing] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/persons/me/email-change`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.ok) setPending((await res.json()) as PendingEmailChange | null);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [apiUrl]);

  async function requestChange() {
    const normalized = newEmail.trim().toLowerCase();
    setMessage(null);
    setError(null);
    if (!EMAIL_RE.test(normalized)) {
      setError(t('publicApp.emailChange.invalidEmail'));
      return;
    }
    if (normalized === (email ?? '').trim().toLowerCase()) {
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
      setPending((await res.json()) as PendingEmailChange);
      setNewEmail('');
      setEditing(false);
      setMessage(t('publicApp.emailChange.requestSuccess'));
    } catch {
      setError(t('publicApp.emailChange.requestError'));
    } finally {
      setSaving(false);
    }
  }

  async function cancelChange() {
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
    <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
      <h2 className="font-display text-lg font-semibold text-foreground">
        {t('publicApp.security.emailSectionTitle')}
      </h2>

      <div className="mt-3 divide-y divide-border">
        <div className="flex items-start justify-between gap-4 py-2.5">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">
              {t('publicApp.meSettings.account.emailLabel')}
            </p>
            <p className="mt-0.5 break-all text-sm text-muted">{email ?? t('common.unknown')}</p>
          </div>
          {!pending && !editing && (
            <button
              type="button"
              onClick={() => {
                setEditing(true);
                setMessage(null);
              }}
              className="flex-shrink-0 text-sm font-semibold text-accent hover:underline"
            >
              {t('publicApp.meSettings.account.changeEmail')}
            </button>
          )}
        </div>
        <div className="flex items-start justify-between gap-4 py-2.5">
          <p className="text-sm font-semibold text-foreground">
            {t('publicApp.security.signInMethodLabel')}
          </p>
          <span className="flex-shrink-0 text-sm font-medium text-muted">
            {hasPassword
              ? t('publicApp.security.signInMethodPassword')
              : t('publicApp.security.signInMethodGoogle')}
          </span>
        </div>
      </div>

      {pending ? (
        <div className="mt-4 rounded-md border border-warning/40 bg-warning/10 p-4">
          <p className="text-sm font-semibold text-warning">
            {t('publicApp.emailChange.pendingTitle')}
          </p>
          <p className="mt-1 text-sm text-warning">
            {t('publicApp.emailChange.pendingDescription', { email: pending.newEmail })}
          </p>
          <button
            type="button"
            onClick={() => void cancelChange()}
            disabled={cancelling}
            className="mt-3 rounded-md border border-warning/50 px-3 py-1.5 text-sm font-semibold text-warning disabled:opacity-50"
          >
            {cancelling
              ? t('publicApp.emailChange.cancelling')
              : t('publicApp.emailChange.cancelPending')}
          </button>
        </div>
      ) : editing ? (
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-sm font-semibold text-foreground">
              {t('publicApp.emailChange.newEmail')}
            </span>
            <input
              type="email"
              autoComplete="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder={t('publicApp.emailChange.newEmailPlaceholder')}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            />
          </label>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="primary"
              loading={saving}
              disabled={saving || !email}
              onClick={() => void requestChange()}
            >
              {saving
                ? t('publicApp.emailChange.sending')
                : t('publicApp.emailChange.sendConfirmation')}
            </Button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setNewEmail('');
                setError(null);
              }}
              className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-background"
            >
              {t('actions.cancel')}
            </button>
          </div>
        </div>
      ) : null}

      {message && (
        <p
          className="mt-3 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success"
          role="status"
        >
          {message}
        </p>
      )}
      {error && (
        <p
          className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
          role="alert"
        >
          {error}
        </p>
      )}
    </section>
  );
}
