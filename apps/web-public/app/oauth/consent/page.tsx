'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useI18n } from '@myclash/next-i18n/client';
import { ConsentCard, type ConsentShown } from './ConsentCard';
import { openConsent } from './consent-requests';

type Phase = { kind: 'loading' } | { kind: 'network' } | { kind: 'shown'; view: ConsentShown };

/**
 * Where GoTrue sends the browser when Claude asks to connect. Signed out: sign in, then come back
 * here. Already agreed: go straight back to Claude. Otherwise the card asks.
 */
function Consent() {
  const { t } = useI18n();
  const authorizationId = useSearchParams().get('authorization_id');
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void openConsent(authorizationId).then((opened) => {
      if (cancelled) return;
      if (opened.kind === 'login') window.location.replace(opened.href);
      else if (opened.kind === 'go') window.location.replace(opened.redirectUrl);
      else if (opened.kind === 'network') setPhase({ kind: 'network' });
      else setPhase({ kind: 'shown', view: opened });
    });
    return () => {
      cancelled = true;
    };
  }, [authorizationId]);

  if (phase.kind === 'shown') {
    return <ConsentCard authorizationId={authorizationId ?? ''} view={phase.view} />;
  }
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <p
        className={phase.kind === 'network' ? 'text-danger' : 'text-foreground-secondary'}
        role={phase.kind === 'network' ? 'alert' : 'status'}
      >
        {t(
          phase.kind === 'network'
            ? 'publicApp.oauthConsent.unavailable'
            : 'publicApp.oauthConsent.loading',
        )}
      </p>
    </main>
  );
}

export default function OAuthConsentPage() {
  return (
    <Suspense fallback={null}>
      <Consent />
    </Suspense>
  );
}
