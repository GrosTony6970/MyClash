'use client';

import { useState } from 'react';
import { Modal } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { getApiUrl } from '../lib/api-url';
import { CALL_REASONS, sendCall, type CallOutcome, type CallReason } from '../lib/call-request';

type Step = { kind: 'closed' } | { kind: 'pick' } | { kind: 'sending' } | CallResult;
type CallResult = { kind: 'answered'; outcome: CallOutcome };

const OUTCOME_TONE: Record<CallOutcome, string> = {
  sent: 'border-success bg-success/10 text-success',
  offline: 'border-danger bg-danger/10 text-danger',
  refused: 'border-danger bg-danger/10 text-danger',
};

/**
 * The referee's call to the control room (ruling 952): Medic, Head referee or
 * Dispute. The piste's row on the organisers' Live board turns red, "Needs
 * attention", until one of them acknowledges it.
 *
 * It needs the network and says so: a call that reached nobody reads "Not
 * sent", for the referee to call by voice. Nothing is queued — a medic called
 * ten minutes late is no call.
 */
export function CallButton() {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>({ kind: 'closed' });
  const close = () => setStep({ kind: 'closed' });

  const call = async (reason: CallReason) => {
    setStep({ kind: 'sending' });
    setStep({ kind: 'answered', outcome: await sendCall(getApiUrl(), reason) });
  };

  return (
    <>
      <button
        type="button"
        data-testid="call-button"
        onClick={() => setStep({ kind: 'pick' })}
        aria-label={t('scoring.call.buttonLabel')}
        className="inline-flex min-h-[44px] items-center gap-1 rounded-lg border border-danger/50 px-3 py-1.5 text-sm font-semibold text-danger hover:bg-danger/10"
      >
        {t('scoring.call.button')}
      </button>
      <Modal
        open={step.kind !== 'closed'}
        onClose={close}
        busy={step.kind === 'sending'}
        title={t('scoring.call.title')}
        footer={
          <button
            type="button"
            onClick={close}
            disabled={step.kind === 'sending'}
            className="min-h-[44px] rounded-lg border-2 border-border bg-surface px-4 py-2 text-sm font-bold text-foreground-secondary hover:bg-border"
          >
            {step.kind === 'answered' ? t('scoring.call.close') : t('common.cancel')}
          </button>
        }
      >
        {step.kind === 'answered' ? (
          <p
            role="status"
            data-testid="call-outcome"
            className={`rounded-lg border-2 px-3 py-2 text-sm font-semibold ${OUTCOME_TONE[step.outcome]}`}
          >
            {t(`scoring.call.outcome.${step.outcome}`)}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-foreground-secondary">{t('scoring.call.intro')}</p>
            <div className="flex flex-wrap gap-2">
              {CALL_REASONS.map((reason) => (
                <button
                  key={reason}
                  type="button"
                  disabled={step.kind === 'sending'}
                  onClick={() => void call(reason)}
                  className="min-h-[44px] flex-1 rounded-lg border-2 border-danger bg-danger/15 px-4 py-2 text-sm font-bold text-danger hover:bg-danger/30 disabled:opacity-50"
                >
                  {t(`scoring.call.reason.${reason}`)}
                </button>
              ))}
            </div>
            {step.kind === 'sending' && (
              <p className="text-sm text-muted">{t('scoring.call.sending')}</p>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
