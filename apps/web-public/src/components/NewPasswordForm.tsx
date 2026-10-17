'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Button, PasswordChecklist } from '@myclash/ui';
import { validatePassword } from '@myclash/types';
import { PasswordPanel } from './PasswordPanel';

interface NewPasswordFormProps {
  t: (key: string) => string;
  title: string;
  description: string;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  /** Called with a password that meets the policy and matches its confirmation. */
  onSubmit: (password: string) => void;
  /** Shown under the error: a way out, such as "Forgot password?". */
  children?: ReactNode;
}

/**
 * The page that sets a password from a mailed link: the reset page and the "choose your
 * password" page of a sign-up. The two fields, the policy checklist, one button that stays
 * off until both fields agree and meet the policy. The page owns the request and the words
 * of its answer.
 */
export function NewPasswordForm(props: NewPasswordFormProps) {
  const { t, busy, error } = props;
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const validation = useMemo(() => validatePassword(password), [password]);

  return (
    <PasswordPanel title={props.title}>
      <p className="mt-2 text-sm leading-6 text-muted">{props.description}</p>
      <PasswordInput
        label={t('publicApp.resetPassword.newPassword')}
        value={password}
        onChange={setPassword}
        className="mt-6"
      />
      <PasswordInput
        label={t('publicApp.login.passwordConfirmLabel')}
        value={confirm}
        onChange={setConfirm}
        className="mt-4"
      />
      <PasswordChecklist failing={validation.failing} t={t} className="mt-3 space-y-1 text-xs" />
      <Button
        type="button"
        variant="primary"
        className="mt-5 w-full py-3"
        disabled={busy || !validation.ok || password !== confirm}
        loading={busy}
        onClick={() => props.onSubmit(password)}
      >
        {busy ? t('common.loading') : props.submitLabel}
      </Button>
      {error && (
        <p
          className="mt-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
          role="alert"
        >
          {error}
        </p>
      )}
      {props.children}
    </PasswordPanel>
  );
}

function PasswordInput(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className: string;
}) {
  return (
    <label className={`${props.className} block`}>
      <span className="text-sm font-semibold text-foreground-secondary">{props.label}</span>
      <input
        type="password"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        autoComplete="new-password"
        className="mt-2 w-full rounded-md border border-border bg-background px-3 py-3 text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
      />
    </label>
  );
}
