'use client';

import { useState } from 'react';
import type { ConsentAction, ConsentView } from '@myclash/types';
import { Button } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { answerConsent } from './consent-requests';

/** What the card can show: `go` never reaches it, the page sends the browser straight on. */
export type ConsentShown = Exclude<ConsentView, { kind: 'go' }>;

/**
 * The consent page's one screen. An `ask` shows who is asking, where the person goes back to,
 * what Claude will see, and Approve / Deny. Both answers end the same way: the browser goes to
 * the redirect the server hands back (Deny's carries `access_denied` to Claude).
 *
 * Two clicks cannot race: both buttons are disabled while a request is in flight, and a failed
 * one re-enables them. A server that refuses or finds the request gone replaces the card's view,
 * so a refused request never keeps an Approve button.
 */
export function ConsentCard({
  authorizationId,
  view: first,
}: {
  authorizationId: string;
  view: ConsentShown;
}) {
  const [view, setView] = useState<ConsentShown>(first);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function answer(action: ConsentAction): Promise<void> {
    setBusy(true);
    setFailed(false);
    const result = await answerConsent(authorizationId, action);
    // The browser is leaving in both of these: the buttons stay disabled.
    if ('redirectUrl' in result) {
      window.location.assign(result.redirectUrl);
      return;
    }
    if (result.kind === 'login') {
      // The login lapsed while the card was open: sign in, then come back to this request.
      window.location.replace(result.href);
      return;
    }
    if (result.kind === 'refused')
      setView({ kind: 'refused', reason: 'not-claude', redirectHost: '' });
    else if (result.kind === 'expired') setView({ kind: 'expired' });
    else setFailed(true);
    setBusy(false);
  }

  if (view.kind === 'expired') return <ExpiredView />;
  if (view.kind === 'refused') return <RefusedView host={view.redirectHost} />;
  return <AskView view={view} busy={busy} failed={failed} onAnswer={(a) => void answer(a)} />;
}

function ExpiredView() {
  const { t } = useI18n();
  return (
    <Frame>
      <p role="alert">{t('publicApp.oauthConsent.expired')}</p>
    </Frame>
  );
}

function RefusedView({ host }: { host: string }) {
  const { t } = useI18n();
  return (
    <Frame>
      <p className="text-danger" role="alert">
        {t('publicApp.oauthConsent.refused', {
          host: host || t('publicApp.oauthConsent.unknownHost'),
        })}
      </p>
    </Frame>
  );
}

function AskView({
  view,
  busy,
  failed,
  onAnswer,
}: {
  view: Extract<ConsentShown, { kind: 'ask' }>;
  busy: boolean;
  failed: boolean;
  onAnswer: (action: ConsentAction) => void;
}) {
  const { t } = useI18n();
  const where =
    view.callback === 'this-computer'
      ? t('publicApp.oauthConsent.whereThisComputer')
      : t('publicApp.oauthConsent.whereClaude');

  return (
    <Frame title={t('publicApp.oauthConsent.title', { client: view.clientName })}>
      <p className="text-foreground-secondary">{t('publicApp.oauthConsent.back', { where })}</p>
      <p className="mt-4">{t('publicApp.oauthConsent.privacy')}</p>
      {failed ? (
        <p className="mt-4 text-danger" role="alert">
          {t('publicApp.oauthConsent.unavailable')}
        </p>
      ) : null}
      <div className="mt-6 flex flex-col gap-2">
        <Button disabled={busy} onClick={() => onAnswer('approve')}>
          {t('publicApp.oauthConsent.approve')}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => onAnswer('deny')}>
          {t('publicApp.oauthConsent.deny')}
        </Button>
      </div>
    </Frame>
  );
}

function Frame({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-sm text-left">
        {title ? (
          <h1 className="mb-4 font-display font-bold text-2xl sm:text-3xl">{title}</h1>
        ) : null}
        {children}
      </div>
    </main>
  );
}
