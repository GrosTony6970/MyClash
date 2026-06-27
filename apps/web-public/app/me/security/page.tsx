'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@myclash/ui';
import { validatePassword } from '@myclash/types';
import { getApiUrl } from '@/lib/api-url';
import { useI18n } from '../../../src/i18n/I18nProvider';

interface SecurityStatus {
  hasPassword: boolean;
  email: string | null;
}

export default function SecurityPage() {
  const { t } = useI18n();
  const apiUrl = useMemo(() => getApiUrl(), []);
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
        <p className="mx-auto max-w-2xl rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {t('publicApp.security.loadError')}
        </p>
      </main>
    );
  }

  return (
    <main className="px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <header>
          <h1 className="font-display font-bold text-2xl sm:text-3xl text-[#0f172a]">
            {t('publicApp.security.title')}
          </h1>
          <p className="mt-2 text-sm text-slate-600">{t('publicApp.security.subtitle')}</p>
        </header>

        {status && (
          <>
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

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="font-display font-semibold text-lg sm:text-xl text-[#0f172a]">
        {t('publicApp.security.changePasswordTitle')}
      </h2>

      {!status.hasPassword ? (
        // Google-only accounts sign in through Google — no password to set.
        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          <p className="font-semibold text-slate-700">{t('publicApp.security.googleOnlyTitle')}</p>
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
            <p className="text-xs text-red-600">{t('publicApp.login.errors.passwordMismatch')}</p>
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
        </div>
      )}

      {message && (
        <p
          className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
          role="status"
        >
          {message}
        </p>
      )}
      {error && (
        <p
          className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
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
    <section className="rounded-lg border border-red-200 bg-white p-5 shadow-sm">
      <h2 className="font-display font-semibold text-lg sm:text-xl text-red-800">
        {t('publicApp.security.deleteTitle')}
      </h2>
      <p className="mt-2 text-sm text-slate-600">{t('publicApp.security.deleteSubtitle')}</p>

      {!open ? (
        <Button
          type="button"
          variant="ghost"
          className="mt-3 border border-red-300 text-red-700 hover:bg-red-50"
          onClick={() => setOpen(true)}
        >
          {t('publicApp.security.deleteAction')}
        </Button>
      ) : (
        <div
          className="mt-3 rounded-md border border-red-300 bg-red-50 p-4"
          role="alertdialog"
          aria-modal="true"
          aria-label={t('publicApp.security.deleteModalTitle')}
        >
          <p className="text-sm font-bold text-red-800">
            {t('publicApp.security.deleteModalTitle')}
          </p>
          <p className="mt-2 text-sm text-red-700">{t('publicApp.security.deleteModalBody')}</p>
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
              <span className="text-sm font-semibold text-slate-700">
                {t('publicApp.security.deleteConfirmationLabel')}
              </span>
              <input
                type="text"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                placeholder="DELETE"
                className="mt-1 w-full rounded-md border border-red-300 bg-white px-3 py-2 text-sm uppercase outline-none focus:border-red-500"
                autoComplete="off"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!canSubmit || busy}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? t('common.loading') : t('publicApp.security.deleteConfirmAction')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setCurrentPassword('');
                  setConfirmation('');
                  setError(null);
                }}
                disabled={busy}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                {t('actions.cancel')}
              </button>
            </div>
          </div>
          {error && (
            <p
              className="mt-3 rounded-md border border-red-300 bg-white px-3 py-2 text-sm text-red-700"
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
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#1d4ed8] focus:ring-1 focus:ring-[#1d4ed8]"
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
          <li key={rule} className={failed ? 'text-slate-500' : 'text-emerald-600'}>
            <span aria-hidden>{failed ? '○' : '✓'}</span> {t(key)}
          </li>
        );
      })}
    </ul>
  );
}
