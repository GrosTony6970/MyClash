'use client';

import { AuthField, Button, GoogleIcon, PasswordChecklist } from '@myclash/ui';
import { validatePassword } from '@myclash/types';
import { LegalConsent } from '../../src/components/LegalConsent';
import type { SignupIntent } from './auth-form-state';
import { normalizeSlugInput, slugify } from './auth-form-state';
import type { LoadingAction, Translate } from './signin-forms';

export interface SlugStatus {
  checking: boolean;
  available: boolean | null;
  reason?: 'reserved' | 'taken';
}

// ── Signup step 1: the account ─────────────────────────────────────────────

export interface AccountDraft {
  email: string;
  displayName: string;
  password: string;
  passwordConfirm: string;
  acceptedLegal: boolean;
}

export function AccountStepForm({
  t,
  draft,
  onChange,
  disabled,
  onSubmit,
}: {
  t: Translate;
  draft: AccountDraft;
  onChange: (patch: Partial<AccountDraft>) => void;
  disabled: boolean;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <AuthField
        id="signup-email"
        type="email"
        autoComplete="email"
        label={t('auth.signup.emailLabel')}
        placeholder={t('auth.login.emailPlaceholder')}
        value={draft.email}
        onChange={(event) => onChange({ email: event.target.value })}
      />
      <AuthField
        id="displayName"
        type="text"
        autoComplete="name"
        label={t('auth.signup.displayNameLabel')}
        placeholder={t('auth.signup.displayNamePlaceholder')}
        value={draft.displayName}
        onChange={(event) => onChange({ displayName: event.target.value })}
      />
      {/* No minLength on the input: the rule is five conditions, not a length,
          and the browser's own bubble would say the wrong thing. The checklist
          below is the affordance. */}
      <AuthField
        id="signup-password"
        type="password"
        autoComplete="new-password"
        label={t('auth.signup.passwordLabel')}
        placeholder={t('auth.signup.passwordPlaceholder')}
        value={draft.password}
        onChange={(event) => onChange({ password: event.target.value })}
      />
      <AuthField
        id="passwordConfirm"
        type="password"
        autoComplete="new-password"
        label={t('auth.signup.passwordConfirmLabel')}
        placeholder={t('auth.signup.passwordConfirmPlaceholder')}
        value={draft.passwordConfirm}
        onChange={(event) => onChange({ passwordConfirm: event.target.value })}
      />
      <PasswordChecklist failing={validatePassword(draft.password).failing} t={t} />
      <LegalConsent
        checked={draft.acceptedLegal}
        onChange={(acceptedLegal) => onChange({ acceptedLegal })}
      />
      <Button type="submit" variant="primary" className="w-full py-3" disabled={disabled}>
        {t('auth.signup.continue')}
      </Button>
    </form>
  );
}

// ── Signup step 2: the organization ────────────────────────────────────────

export function OrgStepForm({
  t,
  orgName,
  orgSlug,
  slugStatus,
  intent,
  loadingAction,
  onOrgName,
  onOrgSlug,
  onBack,
  onSubmit,
}: {
  t: Translate;
  orgName: string;
  orgSlug: string;
  slugStatus: SlugStatus;
  intent: SignupIntent;
  loadingAction: LoadingAction;
  onOrgName: (name: string, slug: string) => void;
  onOrgSlug: (slug: string) => void;
  onBack: () => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  const submitLabel =
    intent === 'google'
      ? t('auth.oauth.continueWithGoogle')
      : loadingAction === 'signup'
        ? t('auth.signup.creating')
        : intent === 'magic_link'
          ? t('auth.signup.sendSignupLink')
          : t('auth.signup.createAccount');

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <AuthField
        id="orgName"
        type="text"
        required
        label={t('auth.signup.orgNameLabel')}
        placeholder={t('auth.signup.orgNamePlaceholder')}
        hint={t('auth.signup.orgNameHint')}
        value={orgName}
        onChange={(event) => onOrgName(event.target.value, slugify(event.target.value))}
      />

      <div>
        <label className="block text-sm font-semibold text-foreground" htmlFor="orgSlug">
          {t('auth.signup.slugLabel')}
          <SlugStatusNote t={t} status={slugStatus} />
        </label>
        <div className="mt-2 flex items-center overflow-hidden rounded-md border border-border bg-background focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30">
          <span className="select-none border-r border-border px-3 py-3 text-sm text-muted">
            {'admin.myclash.fr/org/'}
          </span>
          <input
            id="orgSlug"
            type="text"
            required
            value={orgSlug}
            onChange={(event) => onOrgSlug(normalizeSlugInput(event.target.value))}
            placeholder={t('auth.signup.slugPlaceholder')}
            className="flex-1 bg-transparent px-3 py-3 text-foreground outline-none"
          />
        </div>
        <p className="mt-1 text-xs text-muted">{t('auth.signup.slugHint')}</p>
      </div>

      <div className="flex gap-2">
        <Button type="button" variant="ghost" className="flex-1 py-3" onClick={onBack}>
          {t('auth.signup.back')}
        </Button>
        <Button
          type="submit"
          variant="primary"
          className="flex-1 py-3"
          disabled={loadingAction !== null || slugStatus.available === false || slugStatus.checking}
          loading={loadingAction === 'signup'}
          leftIcon={intent === 'google' ? <GoogleIcon /> : undefined}
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function SlugStatusNote({ t, status }: { t: Translate; status: SlugStatus }) {
  if (status.checking) {
    return (
      <span className="ml-2 text-xs font-normal text-muted">{t('auth.signup.slugChecking')}</span>
    );
  }
  if (status.available === true) {
    return (
      <span className="ml-2 text-xs font-normal text-success">
        {t('auth.signup.slugAvailable')}
      </span>
    );
  }
  if (status.available === false) {
    return (
      <span className="ml-2 text-xs font-normal text-danger">
        ✗{' '}
        {status.reason === 'reserved' ? t('auth.signup.slugReserved') : t('auth.signup.slugTaken')}
      </span>
    );
  }
  return null;
}

// ── What a finished signup leaves on screen ────────────────────────────────

export function SignupDone({
  t,
  intent,
  email,
  orgSlug,
}: {
  t: Translate;
  intent: SignupIntent;
  email: string;
  orgSlug: string;
}) {
  if (intent === 'magic_link') {
    return (
      <>
        <h2 className="text-2xl font-black">{t('auth.signup.doneMagicTitle')}</h2>
        <p className="text-sm leading-6 text-foreground-secondary">
          {t('auth.signup.doneMagicPrefix')} <strong>{email}</strong>.{' '}
          {t('auth.signup.doneMagicSuffix')}
        </p>
      </>
    );
  }
  return (
    <>
      <h2 className="text-2xl font-black">{t('auth.signup.doneVerifyTitle')}</h2>
      <p className="text-sm leading-6 text-foreground-secondary">
        {t('auth.signup.doneVerifyCreated')}
      </p>
      <p className="text-sm leading-6 text-foreground-secondary">
        {t('auth.signup.doneVerifyPrefix')} <strong>{email}</strong>.
      </p>
      <a
        href={`/org/${orgSlug}`}
        className="inline-block text-sm font-semibold text-accent hover:underline"
      >
        {t('auth.signup.goToDashboard')}
      </a>
    </>
  );
}
