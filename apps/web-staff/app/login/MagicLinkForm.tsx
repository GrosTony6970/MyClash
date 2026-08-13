'use client';

import Image from 'next/image';
import { useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { api } from '../../src/lib/api';
import { FormError, LabelledInput, SubmitButton } from './fields';

/**
 * Magic-link sign-in for a MyClash account.
 *
 * The organiser's door, not the volunteer's: an event staff PIN account has no
 * email and cannot use this. Kept beside the PIN form because an organiser
 * arriving at the staff app should not have to find a different host.
 *
 * Owns its own "check your email" state, which is why it renders that screen
 * itself rather than lifting a `submitted` flag into the page — the PIN form
 * has no such state and must not be unmounted by it.
 */
export function MagicLinkForm() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      // ApiClientError carries the problem+json detail in its message.
      await api.post('/api/v1/auth/magic-link', { email, type: 'login', redirectTo: '/lices' });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  if (submitted) return <CheckEmailNotice email={email} />;

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      <LabelledInput
        id="email"
        label={t('scoring.login.emailAddress')}
        value={email}
        onChange={setEmail}
        type="email"
        autoComplete="email"
        placeholder={t('scoring.login.emailPlaceholder')}
      />
      <FormError message={error} />
      <SubmitButton
        busy={loading}
        label={loading ? t('scoring.login.sending') : t('scoring.login.sendLoginLink')}
      />
    </form>
  );
}

function CheckEmailNotice({ email }: { email: string }) {
  const { t } = useI18n();

  return (
    <div className="text-center">
      <Image
        src="/brand/Logomini_nobackground.png"
        alt={t('metadata.scoringTitle')}
        width={80}
        height={80}
        className="mx-auto mb-6 h-20 w-20"
      />
      <h2 className="text-2xl font-bold mb-4">{t('scoring.login.checkEmailTitle')}</h2>
      <p className="text-muted">
        {t('scoring.login.checkEmailPrefix')} <strong className="text-foreground">{email}</strong>.{' '}
        {t('scoring.login.checkEmailSuffix')}
      </p>
      <p className="mt-4 text-sm text-muted">{t('scoring.login.linkExpires')}</p>
    </div>
  );
}
