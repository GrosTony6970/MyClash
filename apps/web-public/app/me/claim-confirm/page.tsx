'use client';

import { Suspense, useEffect, useState } from 'react';
import { getPublicApiUrl } from '@/lib/api-url';
import { Button } from '@myclash/ui';
import { useRouter, useSearchParams } from 'next/navigation';
import { useI18n } from '@myclash/next-i18n/client';

type Phase = 'validating' | 'confirming' | 'redirecting';

type CallbackError = {
  phase: Phase;
  messageKey: string;
  cause: { name: string; message: string };
};

class ValidationError extends Error {
  readonly messageKey: string;
  constructor(messageKey: string) {
    super(messageKey);
    this.name = 'ValidationError';
    this.messageKey = messageKey;
  }
}

class ServerRejectedError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(status: number, statusText: string, code: string | null) {
    super(`HTTP ${status} ${statusText}`);
    this.name = 'ServerRejectedError';
    this.status = status;
    this.code = code;
  }
}

function classifyError(phase: Phase, err: unknown): CallbackError {
  const cause = {
    name: err instanceof Error ? err.name : 'Error',
    message: err instanceof Error ? err.message : String(err),
  };
  if (err instanceof ValidationError) {
    return { phase, messageKey: err.messageKey, cause };
  }
  if (err instanceof ServerRejectedError) {
    if (err.code === 'expired_or_used') {
      return { phase, messageKey: 'publicApp.claim.errors.expired', cause };
    }
    if (err.code === 'already_claimed') {
      return { phase, messageKey: 'publicApp.claim.errors.alreadyClaimed', cause };
    }
    if (err.code === 'user_mismatch') {
      return { phase, messageKey: 'publicApp.claim.errors.userMismatch', cause };
    }
    return { phase, messageKey: 'publicApp.claim.errors.serverRejected', cause };
  }
  if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return { phase, messageKey: 'publicApp.claim.errors.timeout', cause };
  }
  return { phase, messageKey: 'publicApp.claim.errors.network', cause };
}

function ClaimConfirm() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<CallbackError | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function finalize(): Promise<void> {
      let phase: Phase = 'validating';
      try {
        const token = searchParams.get('token');
        if (!token) {
          throw new ValidationError('publicApp.claim.errors.missingToken');
        }

        phase = 'confirming';
        const apiUrl = getPublicApiUrl();
        const response = await fetch(`${apiUrl}/api/v1/me/claim-confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          signal: AbortSignal.timeout(15000),
          body: JSON.stringify({ token }),
        });

        if (!response.ok) {
          let code: string | null = null;
          try {
            // This endpoint throws its machine code AS the message
            // (`expired_or_used`, `already_claimed`, `user_mismatch` in
            // auth.service.ts), so `message` is what the branches below match.
            // The read used to start with `body.error ??`, and the problem+json
            // envelope has no `error` member — that half was always undefined.
            const body = (await response.json()) as { message?: string };
            code = body.message ?? null;
          } catch {
            /* body wasn't JSON — keep code null */
          }
          throw new ServerRejectedError(response.status, response.statusText, code);
        }

        phase = 'redirecting';
        router.replace('/me?claimed=1');
      } catch (err) {
        if (cancelled) return;
        const classified = classifyError(phase, err);
        console.error('[claim-confirm]', classified.phase, classified.cause);
        setError(classified);
      }
    }

    void finalize();
    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  if (error) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-8">
        <div className="w-full max-w-sm text-center">
          <h1 className="mb-4 font-display font-bold text-2xl sm:text-3xl">
            {t('publicApp.claim.errorTitle')}
          </h1>
          <p className="text-danger" role="alert">
            {t(error.messageKey)}
          </p>
          <details className="mt-4 text-left text-xs text-muted">
            <summary className="cursor-pointer">{t('auth.oauth.detailsToggle')}</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words">
              {error.phase}: {error.cause.name} — {error.cause.message}
            </pre>
          </details>
          <div className="mt-6 flex flex-col gap-2">
            <Button onClick={() => router.replace('/me')}>{t('publicApp.claim.backToMe')}</Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-sm text-center">
        <h1 className="mb-4 font-display font-bold text-2xl sm:text-3xl">
          {t('publicApp.claim.confirming')}
        </h1>
        <p className="text-foreground-secondary">{t('publicApp.claim.confirmingWait')}</p>
      </div>
    </main>
  );
}

export default function ClaimConfirmPage() {
  return (
    <Suspense fallback={null}>
      <ClaimConfirm />
    </Suspense>
  );
}
