'use client';

import Image from 'next/image';
import { useMemo, useState, type ReactNode } from 'react';
import { validatePassword } from '@myclash/types';
import { AuthField, AuthNotice, AuthPanel, Button, PasswordChecklist } from '@myclash/ui';

type Translate = (key: string) => string;

/**
 * The panel of a page that sets a password from a mailed link, in the organizer app: the
 * reset page and the sign-up's "choose your password" page. The login's panel, so the whole
 * flow stays on one host and one design.
 */
export function NewPasswordPanel({
  t,
  footer,
  children,
}: {
  t: Translate;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <AuthPanel
      mainId="main-content"
      brandHref="/"
      brandName={t('app.name')}
      eyebrow={t('auth.login.eyebrow')}
      title={t('auth.login.title')}
      subtitle={t('auth.login.subtitle')}
      brandMark={
        <Image
          src="/brand/Logomini_nobackground.png"
          alt=""
          width={48}
          height={48}
          priority
          className="h-11 w-11 lg:h-12 lg:w-12"
        />
      }
      heroArt={
        <Image
          src="/brand/Login_logo.png"
          alt=""
          width={1423}
          height={1007}
          className="mx-auto mb-8 h-auto w-full max-w-md"
          priority
        />
      }
      footer={footer}
    >
      {children}
    </AuthPanel>
  );
}

interface FieldsProps {
  t: Translate;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  /** Called with a password that meets the policy and matches its confirmation. */
  onSubmit: (password: string) => void;
}

/**
 * The two password fields, the policy checklist, and one button that stays off until both
 * fields agree and meet the policy. The page owns the request and the words of its answer.
 */
export function NewPasswordFields({ t, submitLabel, busy, error, onSubmit }: FieldsProps) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const validation = useMemo(() => validatePassword(password), [password]);

  return (
    <>
      <AuthField
        id="new-password"
        type="password"
        autoComplete="new-password"
        label={t('auth.resetPassword.newPassword')}
        placeholder={t('auth.signup.passwordPlaceholder')}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <AuthField
        id="new-password-confirm"
        type="password"
        autoComplete="new-password"
        label={t('auth.signup.passwordConfirmLabel')}
        placeholder={t('auth.signup.passwordConfirmPlaceholder')}
        value={confirm}
        onChange={(event) => setConfirm(event.target.value)}
      />
      <PasswordChecklist failing={validation.failing} t={t} />
      <Button
        type="button"
        variant="primary"
        className="w-full py-3"
        disabled={busy || !validation.ok || password !== confirm}
        loading={busy}
        onClick={() => onSubmit(password)}
      >
        {busy ? t('common.loading') : submitLabel}
      </Button>
      {error && <AuthNotice tone="error">{error}</AuthNotice>}
    </>
  );
}
