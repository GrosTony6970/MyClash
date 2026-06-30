'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@myclash/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { SettingRow } from './controls';

interface SecurityStatus {
  hasPassword: boolean;
  email: string | null;
}

interface PendingEmailChange {
  newEmail: string;
  expiresAt: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Account block of the settings hub: current email, a compact email-change
 * flow (reusing the existing `/api/v1/persons/me/email-change` endpoints and
 * `publicApp.emailChange.*` strings), a display-only language row, and links
 * to the existing security page for password + account deletion.
 */
export function AccountSection({ apiUrl }: { apiUrl: string }) {
  const { t, locale } = useI18n();
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [pending, setPending] = useState<PendingEmailChange | null>(null);
  const [editing, setEditing] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/me/security-status`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.ok) setStatus((await res.json()) as SecurityStatus);
      })
      .catch(() => undefined);

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
    if (normalized === (status?.email ?? '').trim().toLowerCase()) {
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

  const linkRow =
    'flex items-center justify-between gap-4 rounded-md border border-border bg-background px-3 py-2.5 text-sm font-semibold text-foreground hover:bg-foreground/5';

  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
      <h2 className="font-display text-lg font-semibold text-foreground">
        {t('publicApp.meSettings.sectionAccount')}
      </h2>

      <div className="mt-3 divide-y divide-border">
        <SettingRow
          label={t('publicApp.meSettings.account.emailLabel')}
          control={
            <span className="break-all text-sm font-medium text-muted">
              {status?.email ?? t('common.unknown')}
            </span>
          }
        />
        <SettingRow
          label={t('publicApp.meSettings.account.languageLabel')}
          description={t('publicApp.meSettings.account.languageNote')}
          control={
            <span className="text-sm font-medium text-muted">
              {locale === 'fr'
                ? t('publicApp.meSettings.account.languageFrench')
                : t('publicApp.meSettings.account.languageEnglish')}
            </span>
          }
        />
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
              disabled={saving || !status?.email}
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
      ) : (
        <button
          type="button"
          onClick={() => {
            setEditing(true);
            setMessage(null);
          }}
          className="mt-4 text-sm font-semibold text-accent hover:underline"
        >
          {t('publicApp.meSettings.account.changeEmail')}
        </button>
      )}

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

      <div className="mt-4 space-y-2">
        <Link href="/me/security" className={linkRow}>
          <span>{t('publicApp.meSettings.account.passwordLink')}</span>
          <span aria-hidden className="text-muted">
            →
          </span>
        </Link>
        <Link href="/me/security" className={linkRow}>
          <span>{t('publicApp.meSettings.account.deleteLink')}</span>
          <span aria-hidden className="text-muted">
            →
          </span>
        </Link>
      </div>
    </section>
  );
}
