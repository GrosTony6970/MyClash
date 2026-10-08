'use client';

import { useState } from 'react';
import { passwordSetLinkRefusalKey, requestPasswordSetLink } from './security-requests';

interface PasswordSetLinkProps {
  apiUrl: string;
  email: string | null;
  label: string;
  t: (key: string, values?: Record<string, string | number>) => string;
}

/**
 * The way out for an account that cannot type its current password (operator ruling 351):
 * one that forgot it, and one made by a mailed sign-in link, which never chose one. It mails
 * a link that sets a password. Both sections that ask the current password show it.
 */
export function PasswordSetLink({ apiUrl, email, label, t }: PasswordSetLinkProps) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(to: string): Promise<void> {
    setBusy(true);
    setError(null);
    const answer = await requestPasswordSetLink(apiUrl, to);
    setBusy(false);
    if (answer === 'sent') setSent(true);
    else setError(t(passwordSetLinkRefusalKey(answer)));
  }

  if (!email) return null;
  if (sent) {
    return (
      <p className="text-sm text-muted" role="status">
        {t('publicApp.security.forgotPasswordSent', { email })}
      </p>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void send(email)}
        disabled={busy}
        className="block text-left text-sm font-semibold text-accent hover:underline disabled:opacity-50"
      >
        {label}
      </button>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
