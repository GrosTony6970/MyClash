'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@myclash/ui';
import { validatePassword } from '@myclash/types';
import { getPublicApiUrl } from '@/lib/api-url';
import { EmailChangeSection } from '@/components/account/EmailChangeSection';
import { useI18n } from '../../../src/i18n/I18nProvider';

interface SecurityStatus {
  hasPassword: boolean;
  email: string | null;
}

export default function SecurityPage() {
  const { t } = useI18n();
  const apiUrl = useMemo(() => getPublicApiUrl(), []);
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [statusError, setStatusError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    // Inline fetch keeps setState inside Promise callbacks (vs. being
    // called from the effect body via an awaited helper) — satisfies
    // react-hooks/set-state-in-effect.
    fetch(`${apiUrl}/api/v1/me/security-status`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.status === 401) {
          window.location.replace('/login');
          return;
        }
        if (!res.ok) throw new Error('status');
        setStatus((await res.json()) as SecurityStatus);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setStatusError(true);
      });
    return () => controller.abort();
  }, [apiUrl]);

  if (statusError) {
    return (
      <main className="px-4 py-6 sm:px-6 lg:px-8">
        <p className="mx-auto max-w-2xl rounded-md border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
          {t('publicApp.security.loadError')}
        </p>
      </main>
    );
  }

  return (
    <main className="px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <header>
          <h1 className="font-display font-bold text-2xl sm:text-3xl text-foreground">
            {t('publicApp.security.title')}
          </h1>
          <p className="mt-2 text-sm text-muted">{t('publicApp.security.subtitle')}</p>
        </header>

        {status && (
          <>
            <EmailChangeSection
              apiUrl={apiUrl}
              email={status.email}
              hasPassword={status.hasPassword}
            />
            <ChangePasswordSection apiUrl={apiUrl} status={status} t={t} />
            <DeleteAccountSection apiUrl={apiUrl} status={status} t={t} />
          </>
        )}
      </div>
    </main>
  );
}

function ChangePasswordSection({
  apiUrl,
  status,
  t,
}: {
  apiUrl: string;
  status: SecurityStatus;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const validation = useMemo(() => validatePassword(newPassword), [newPassword]);

  async function submit(): Promise<void> {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/me/change-password`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (res.status === 401) {
        setError(t('publicApp.security.errors.wrongCurrentPassword'));
        return;
      }
      if (!res.ok) {
        setError(t('publicApp.security.errors.changePasswordFailed'));
        return;
      }
      setMessage(t('publicApp.security.changePasswordSuccess'));
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
    } catch {
      setError(t('publicApp.security.errors.network'));
    } finally {
      setBusy(false);
    }
  }

  // Forgot-password escape hatch for accounts that already have a password:
  // emails a Supabase recovery link via /reset-password. The endpoint always
  // returns a generic message (anti-enumeration), so any non-throw is treated
  // as "sent"; only a network failure surfaces an error.
  async function requestReset(): Promise<void> {
    if (!status.email) return;
    setResetBusy(true);
    setError(null);
    try {
      await fetch(`${apiUrl}/api/v1/auth/public-password-reset`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: status.email }),
      });
      setResetSent(true);
    } catch {
      setError(t('publicApp.security.errors.network'));
    } finally {
      setResetBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
      <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
        {t('publicApp.security.changePasswordTitle')}
      </h2>

      {!status.hasPassword ? (
        // Google-only accounts sign in through Google — no password to set.
        <div className="mt-4 rounded-md border border-border bg-background p-4 text-sm text-muted">
          <p className="font-semibold text-foreground">{t('publicApp.security.googleOnlyTitle')}</p>
          <p className="mt-1">{t('publicApp.security.googleOnlyBody')}</p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <PasswordField
            label={t('publicApp.security.currentPassword')}
            value={currentPassword}
            onChange={setCurrentPassword}
            autoComplete="current-password"
          />
          <PasswordField
            label={t('publicApp.security.newPassword')}
            value={newPassword}
            onChange={setNewPassword}
            autoComplete="new-password"
          />
          <PasswordField
            label={t('publicApp.login.passwordConfirmLabel')}
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
          />
          <PasswordChecklist failing={validation.failing} t={t} />
          {newPassword && confirm && newPassword !== confirm && (
            <p className="text-xs text-danger">{t('publicApp.login.errors.passwordMismatch')}</p>
          )}
          <Button
            type="button"
            disabled={busy || !validation.ok || newPassword !== confirm || !currentPassword}
            loading={busy}
            variant="primary"
            onClick={() => void submit()}
          >
            {busy ? t('common.loading') : t('publicApp.security.changePasswordAction')}
          </Button>
          {resetSent ? (
            <p className="text-sm text-muted">
              {t('publicApp.security.forgotPasswordSent', { email: status.email ?? '' })}
            </p>
          ) : (
            <button
              type="button"
              onClick={() => void requestReset()}
              disabled={resetBusy}
              className="block text-sm font-semibold text-accent hover:underline disabled:opacity-50"
            >
              {t('publicApp.security.forgotPasswordLink')}
            </button>
          )}
        </div>
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
    </section>
  );
}

function DeleteAccountSection({
  apiUrl,
  status,
  t,
}: {
  apiUrl: string;
  status: SecurityStatus;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Password re-auth only for accounts that have a password; Google-only
  // accounts delete via the typed confirmation alone.
  const canSubmit =
    confirmation === 'DELETE' && (status.hasPassword ? Boolean(currentPassword) : true);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/me/account`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, confirmation }),
      });
      if (res.status === 401) {
        setError(t('publicApp.security.errors.wrongCurrentPassword'));
        return;
      }
      if (res.status === 400) {
        const body = (await res.json().catch(() => ({}))) as { code?: string };
        if (body.code === 'no_password_set') {
          setError(t('publicApp.security.errors.noPasswordSet'));
          return;
        }
        setError(t('publicApp.security.errors.confirmationMismatch'));
        return;
      }
      if (!res.ok) {
        setError(t('publicApp.security.errors.deleteFailed'));
        return;
      }
      window.location.replace('/?account_deleted=1');
    } catch {
      setError(t('publicApp.security.errors.network'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-danger/40 bg-surface p-5 shadow-sm">
      <h2 className="font-display font-semibold text-lg sm:text-xl text-danger">
        {t('publicApp.security.deleteTitle')}
      </h2>
      <p className="mt-2 text-sm text-muted">{t('publicApp.security.deleteSubtitle')}</p>

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 rounded-md border border-danger/40 px-4 py-2 text-sm font-semibold text-danger hover:bg-danger/10"
        >
          {t('publicApp.security.deleteAction')}
        </button>
      ) : (
        <div
          className="mt-3 rounded-md border border-danger/40 bg-danger/10 p-4"
          role="alertdialog"
          aria-modal="true"
          aria-label={t('publicApp.security.deleteModalTitle')}
        >
          <p className="text-sm font-bold text-danger">
            {t('publicApp.security.deleteModalTitle')}
          </p>
          <p className="mt-2 text-sm text-danger">{t('publicApp.security.deleteModalBody')}</p>
          <div className="mt-3 space-y-3">
            {status.hasPassword && (
              <PasswordField
                label={t('publicApp.security.currentPassword')}
                value={currentPassword}
                onChange={setCurrentPassword}
                autoComplete="current-password"
              />
            )}
            <label className="block">
              <span className="text-sm font-semibold text-foreground">
                {t('publicApp.security.deleteConfirmationLabel')}
              </span>
              <input
                type="text"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                placeholder="DELETE"
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm uppercase text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                autoComplete="off"
              />
            </label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="danger"
                loading={busy}
                disabled={!canSubmit || busy}
                onClick={() => void submit()}
              >
                {t('publicApp.security.deleteConfirmAction')}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setCurrentPassword('');
                  setConfirmation('');
                  setError(null);
                }}
                disabled={busy}
                className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-background disabled:opacity-50"
              >
                {t('actions.cancel')}
              </button>
            </div>
          </div>
          {error && (
            <p
              className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
              role="alert"
            >
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-foreground">{label}</span>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
      />
    </label>
  );
}

function PasswordChecklist({ failing, t }: { failing: string[]; t: (key: string) => string }) {
  const rules = [
    { rule: 'length', key: 'publicApp.login.passwordRules.length' },
    { rule: 'uppercase', key: 'publicApp.login.passwordRules.uppercase' },
    { rule: 'lowercase', key: 'publicApp.login.passwordRules.lowercase' },
    { rule: 'digit', key: 'publicApp.login.passwordRules.digit' },
    { rule: 'special', key: 'publicApp.login.passwordRules.special' },
  ] as const;
  return (
    <ul className="space-y-1 text-xs">
      {rules.map(({ rule, key }) => {
        const failed = failing.includes(rule);
        return (
          <li key={rule} className={failed ? 'text-muted' : 'text-success'}>
            <span aria-hidden>{failed ? '○' : '✓'}</span> {t(key)}
          </li>
        );
      })}
    </ul>
  );
}
