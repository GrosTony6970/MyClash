'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { useState } from 'react';
import { useConfirm } from '@myclash/ui';
import { getPublicApiUrl } from '@/lib/api-url';

interface Props {
  eventId: string;
  disabled?: boolean;
}

interface MailOutResult {
  sent: number;
  skipped: number;
  failed: string[];
  withoutEmail: number;
}

/**
 * Mail an event pass to every unclaimed roster entry that has an address.
 *
 * The counterpart to the self-service pass: a fighter with a MyClash account —
 * or a guest session on their own phone — issues their own from
 * `/e/<slug>/pass`. An entry imported from a CSV and never claimed has neither
 * and may not know MyClash exists, so the pass has to come to them.
 *
 * Its own file rather than more of `persons/page.tsx`, which is already past
 * 2000 lines and heavily represented in the complexity baseline — every line
 * added there re-points the entries below it.
 */
export function MailPassesButton({ eventId, disabled }: Props) {
  const { t } = useI18n();

  const { confirm, confirmDialog } = useConfirm();
  const { busy, result, error, send } = useMailPasses(eventId, confirm);

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => send(false)}
          disabled={busy || disabled}
          data-testid="mail-passes"
          className="border border-border hover:border-border text-foreground-secondary font-medium py-2 px-4 rounded-lg text-sm transition-colors disabled:opacity-50"
        >
          {busy ? t('admin.orgPersons.passes.sending') : t('admin.orgPersons.passes.send')}
        </button>
        {result && (
          <button
            type="button"
            onClick={() => send(true)}
            disabled={busy || disabled}
            className="text-xs text-foreground-secondary underline hover:no-underline disabled:opacity-50"
          >
            {t('admin.orgPersons.passes.resend')}
          </button>
        )}
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}
      {result && !error && <MailOutSummary result={result} />}
      {confirmDialog}
    </div>
  );
}

type Confirm = (opts: { title: string; description: string; danger: boolean }) => Promise<boolean>;

/**
 * The mail-out, confirmed first.
 *
 * Confirmation NAMES the consequence rather than asking "are you sure": this is
 * an irreversible outbound act against a whole roster, and the resend variant
 * additionally retires links people are already holding — which a fighter only
 * discovers at the desk.
 */
function useMailPasses(eventId: string, confirm: Confirm) {
  const { t } = useI18n();

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MailOutResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dispatch = (resend: boolean): void => {
    setBusy(true);
    setError(null);
    void fetch(`${getPublicApiUrl()}/api/v1/events/${eventId}/passes/mail`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resend }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        setResult((await res.json()) as MailOutResult);
      })
      .catch(() => setError(t('admin.orgPersons.passes.error')))
      .finally(() => setBusy(false));
  };

  const send = (resend: boolean): void => {
    void confirm({
      title: resend
        ? t('admin.orgPersons.passes.confirmResendTitle')
        : t('admin.orgPersons.passes.confirmSendTitle'),
      description: resend
        ? t('admin.orgPersons.passes.confirmResendBody')
        : t('admin.orgPersons.passes.confirmSendBody'),
      danger: resend,
    }).then((ok) => {
      if (ok) dispatch(resend);
    });
  };

  return { busy, result, error, send };
}

function MailOutSummary({ result }: { result: MailOutResult }) {
  const { t } = useI18n();

  return (
    <p className="text-xs text-foreground-secondary">
      {t('admin.orgPersons.passes.result', {
        sent: String(result.sent),
        skipped: String(result.skipped),
        withoutEmail: String(result.withoutEmail),
      })}
      {result.failed.length > 0 && (
        // Named, not counted: the organiser has to chase these people, and
        // "3 failed" tells them nothing about who to chase.
        <span className="block text-danger">
          {t('admin.orgPersons.passes.failed', { addresses: result.failed.join(', ') })}
        </span>
      )}
    </p>
  );
}
