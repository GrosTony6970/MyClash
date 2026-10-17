'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiRequest } from '@myclash/api-client';
import { useI18n } from '@myclash/next-i18n/client';
import { getPublicApiUrl } from '@/lib/api-url';
import { afterSignIn } from '@/lib/sign-in-return';
import { forgetSchedules } from '@/components/me/schedule-copy';
import { NewPasswordForm } from '@/components/NewPasswordForm';
import { PasswordPanel } from '@/components/PasswordPanel';
import { SignInWithNewPassword } from '@/components/SignInWithNewPassword';
import {
  chooseAnswer,
  isOutcome,
  type ChooseAnswer,
  type ChooseBody,
  type ChooseRefusal,
} from './choose-answer';

type Translate = (key: string) => string;
type Shown = 'form' | 'sign-in' | 'not-saved' | 'unknown';

const LINK_CLASS = 'mt-4 block text-sm font-semibold text-accent hover:underline';

/**
 * The page a sign-up's mail opens (ruling "Pre-takeover"): she chooses her password here,
 * once her address is proven. Opening it sends nothing: the code is spent only when she
 * sends a password that meets the policy, and ONE request spends it, writes the password and
 * signs her in. Then the phone forgets the schedules it kept for whoever held it before.
 */
function ChoosePassword() {
  const { t } = useI18n();
  const router = useRouter();
  const query = useSearchParams();
  const [shown, setShown] = useState<Shown>('form');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<ChooseRefusal | 'no-token' | null>(null);

  async function submit(password: string): Promise<void> {
    const token = query.get('token_hash');
    if (!token) {
      setAnswer('no-token');
      return;
    }
    setBusy(true);
    setAnswer(null);
    const result = await sendChoice(token, password, query.get('next'));
    // Busy until the page leaves: a second press would send the spent code.
    if (result.kind !== 'signed-in') setBusy(false);
    if (result.kind === 'signed-in' || result.kind === 'not-saved' || result.kind === 'unknown') {
      // She is signed in, by her new password or by the link: the phone is hers now.
      forgetSchedules();
    }
    if (result.kind === 'signed-in') router.replace(afterSignIn(result.next));
    else if (isOutcome(result)) setShown(result.kind);
    else setAnswer(result);
  }

  if (shown !== 'form') return <Outcome t={t} shown={shown} />;

  return (
    <NewPasswordForm
      t={t}
      title={t('publicApp.choosePassword.title')}
      description={t('publicApp.choosePassword.description')}
      submitLabel={t('publicApp.choosePassword.submit')}
      busy={busy}
      error={errorOf(answer, t)}
      onSubmit={(password) => void submit(password)}
    >
      {/* A recovery mail works on any account, confirmed or not (proven 2026-10-17). */}
      {answer !== 'no-token' && answer?.kind === 'expired' && (
        <Link href="/login?tab=reset" className={LINK_CLASS}>
          {t('publicApp.login.forgotPassword')}
        </Link>
      )}
    </NewPasswordForm>
  );
}

/** ONE request: the door spends the code, writes the password and signs her in. */
async function sendChoice(
  token: string,
  password: string,
  next: string | null,
): Promise<ChooseAnswer> {
  const result = await apiRequest<ChooseBody | undefined>(
    getPublicApiUrl(),
    '/api/v1/auth/public-choose-password',
    {
      method: 'POST',
      body: { token_hash: token, password, next: next ?? undefined },
      signal: AbortSignal.timeout(15000),
    },
  );
  return chooseAnswer(result);
}

/** The sentence of a refusal the form stays open on, or none. */
function errorOf(answer: ChooseRefusal | 'no-token' | null, t: Translate): string | null {
  if (!answer) return null;
  if (answer === 'no-token') return t('publicApp.choosePassword.errors.missingToken');
  if (answer.kind === 'expired') return t('publicApp.choosePassword.errors.expired');
  if (answer.kind === 'unchecked') return t('auth.login.errors.linkUnchecked');
  if (answer.kind === 'weak') return t('publicApp.login.errors.weakPassword');
  if (answer.kind === 'network') return t('publicApp.resetPassword.errors.network');
  return t('publicApp.choosePassword.errors.generic');
}

/**
 * What the page says once the code is spent. `sign-in`: the password is saved, but no login
 * was handed. `not-saved` / `unknown`: she is signed in by the code, but the password was
 * refused or not judged; the security page mails a link that sets one (`PasswordSetLink`).
 */
function Outcome({ t, shown }: { t: Translate; shown: Exclude<Shown, 'form'> }) {
  if (shown === 'sign-in') {
    return (
      <SignInWithNewPassword
        t={t}
        title={t('publicApp.choosePassword.title')}
        message={t('publicApp.choosePassword.doneSignIn')}
      />
    );
  }
  return (
    <PasswordPanel title={t('publicApp.choosePassword.title')}>
      <p className="mt-2 text-sm leading-6 text-muted" role="status">
        {shown === 'not-saved'
          ? t('publicApp.choosePassword.notSaved')
          : t('publicApp.choosePassword.unknown')}
      </p>
      <Link href="/me/security" className={LINK_CLASS}>
        {t('publicApp.choosePassword.setPassword')}
      </Link>
    </PasswordPanel>
  );
}

export default function ChoosePasswordPage() {
  return (
    <Suspense fallback={null}>
      <ChoosePassword />
    </Suspense>
  );
}
