'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button, PasswordChecklist } from '@myclash/ui';
import { validatePassword } from '@myclash/types';
import { getPublicApiUrl } from '@/lib/api-url';
import { leaveDeletedAccount } from '@/lib/phone-alerts';
import { EmailChangeSection } from '@/components/account/EmailChangeSection';
import { useI18n } from '@myclash/next-i18n/client';
import { DataAndPrivacySection } from './DataAndPrivacySection';
import { PasswordChangedNotice } from './PasswordChangedNotice';
import { PasswordSetLink } from './PasswordSetLink';
import {
  accountDeletionRefusalKey,
  passwordChangeRefusalKey,
  readSecurityStatus,
  requestAccountDeletion,
  requestPasswordChange,
  type PasswordChanged,
  type SecurityStatus,
} from './security-requests';
import { SessionEnded } from './SessionEnded';

export default function SecurityPage() {
  const { t } = useI18n();
  const apiUrl = useMemo(() => getPublicApiUrl(), []);
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [statusError, setStatusError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    // setState stays inside the promise callback: react-hooks/set-state-in-effect.
    void readSecurityStatus(apiUrl, controller.signal).then((read) => {
      if (read === 'session_ended') window.location.replace('/login');
      else if (read === 'failed') setStatusError(true);
      else if (read !== 'aborted') setStatus(read);
    });
    return () => controller.abort();
  }, [apiUrl]);

  return (
    <main className="px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <header>
          <h1 className="font-display font-bold text-2xl sm:text-3xl text-foreground">
            {t('publicApp.security.title')}
          </h1>
          <p className="mt-2 text-sm text-muted">{t('publicApp.security.subtitle')}</p>
        </header>

        {/* The data export asks nothing of the status: it stays when that read failed. */}
        {statusError && (
          <>
            <p className="rounded-md border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
              {t('publicApp.security.loadError')}
            </p>
            <DataAndPrivacySection apiUrl={apiUrl} t={t} />
          </>
        )}
        {status && (
          <>
            <EmailChangeSection
              apiUrl={apiUrl}
              email={status.email}
              hasPassword={status.hasPassword}
            />
            <ChangePasswordSection apiUrl={apiUrl} status={status} t={t} />
            {/* Before the delete section on purpose: exporting your data is the
                thing you want to do BEFORE deleting the account, not after. */}
            <DataAndPrivacySection apiUrl={apiUrl} t={t} />
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
  const [changed, setChanged] = useState<PasswordChanged | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionEnded, setSessionEnded] = useState(false);

  const validation = useMemo(() => validatePassword(newPassword), [newPassword]);

  async function submit(): Promise<void> {
    setBusy(true);
    setChanged(null);
    setError(null);
    setSessionEnded(false);
    // The request module answers a code for every failure: it never throws.
    const answer = await requestPasswordChange(apiUrl, currentPassword, newPassword);
    setBusy(false);
    if (answer !== 'ok' && answer !== 'sign_in_again') {
      if (answer === 'session_ended') setSessionEnded(true);
      else setError(t(passwordChangeRefusalKey(answer)));
      return;
    }
    setChanged(answer);
    setCurrentPassword('');
    setNewPassword('');
    setConfirm('');
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
          <PasswordSetLink
            apiUrl={apiUrl}
            email={status.email}
            label={t('publicApp.security.forgotPasswordLink')}
            t={t}
          />
        </div>
      )}

      {changed && <PasswordChangedNotice changed={changed} t={t} />}
      {error && (
        <p
          className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
          role="alert"
        >
          {error}
        </p>
      )}
      {sessionEnded && <SessionEnded t={t} />}
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
  const [sessionEnded, setSessionEnded] = useState(false);

  // Password re-auth only for accounts that have a password; Google-only
  // accounts delete via the typed confirmation alone.
  const canSubmit =
    confirmation === 'DELETE' && (status.hasPassword ? Boolean(currentPassword) : true);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    setSessionEnded(false);
    // Neither call throws: the request module answers a code, and the way out of a
    // deleted account catches its own faults. The button stays busy while the page leaves.
    const answer = await requestAccountDeletion(apiUrl, currentPassword, confirmation);
    if (answer !== 'ok') {
      setBusy(false);
      if (answer === 'session_ended') setSessionEnded(true);
      else setError(t(accountDeletionRefusalKey(answer)));
      return;
    }
    await leaveDeletedAccount('/?account_deleted=1');
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
              <>
                <PasswordField
                  label={t('publicApp.security.currentPassword')}
                  value={currentPassword}
                  onChange={setCurrentPassword}
                  autoComplete="current-password"
                />
                <PasswordSetLink
                  apiUrl={apiUrl}
                  email={status.email}
                  label={t('publicApp.security.neverSetPasswordLink')}
                  t={t}
                />
              </>
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
                  setSessionEnded(false);
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
          {sessionEnded && <SessionEnded t={t} />}
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
