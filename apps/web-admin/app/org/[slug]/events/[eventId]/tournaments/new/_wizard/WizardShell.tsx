'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminPageHeader, useToast } from '@myclash/ui';
import { Step1Basics } from './Step1Basics';
import { Step2MatchFormat } from './Step2MatchFormat';
import { Step3Display } from './Step3Display';
import { Step4Advanced } from './Step4Advanced';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import { useEventStatus } from '../../../_hooks/useEventStatus';

type Step = 1 | 2 | 3 | 4;

const STEPS: Array<{ n: Step; key: string }> = [
  { n: 1, key: 'organizer.tournaments.wizard.basics' },
  { n: 2, key: 'organizer.tournaments.wizard.matchFormat' },
  { n: 3, key: 'organizer.tournaments.wizard.display' },
  { n: 4, key: 'organizer.tournaments.wizard.advanced' },
];

interface Props {
  slug: string;
  eventId: string;
  initialTournamentId: string | null;
  initialStep: Step;
}

export function WizardShell({ slug, eventId, initialTournamentId, initialStep }: Props) {
  const { t } = useI18n();

  const router = useRouter();
  const toast = useToast();
  const [tournamentId, setTournamentId] = useState<string | null>(initialTournamentId);
  const [step, setStep] = useState<Step>(initialStep);
  // An archived Event: the server refuses every save of the wizard (ruling 377).
  const { isReadOnly: readOnly } = useEventStatus(eventId);

  function goNext() {
    if (step < 4) setStep((step + 1) as Step);
  }
  function goBack() {
    if (step > 1) setStep((step - 1) as Step);
  }
  async function finish(publish: boolean) {
    // The list is opened either way, after the publish answered (the list reads the
    // status): the Tournament itself does exist. What the organiser must not believe
    // is that a refused publish left it live (O14): ONE toast says what it is, never a
    // green "saved" beside a red reason.
    if (publish && tournamentId) {
      const r = await apiRequest(getPublicApiUrl(), `/api/v1/tournaments/${tournamentId}`, {
        method: 'PATCH',
        body: { status: 'published' },
      });
      if (r.ok) toast.success(t('organizer.tournaments.wizard.publishedToast'));
      else {
        const reason = failureMessage(r, t, t('organizer.tournaments.wizard.publishFailedReason'));
        toast.error(t('organizer.tournaments.wizard.publishFailedToast', { reason: reason ?? '' }));
      }
    } else {
      toast.success(t('organizer.tournaments.wizard.savedDraftToast'));
    }
    router.push(`/org/${slug}/events/${eventId}/tournaments`);
  }

  return (
    <main className={`mx-auto w-full px-6 py-12 lg:px-8 ${step === 3 ? 'max-w-5xl' : 'max-w-2xl'}`}>
      <AdminPageHeader
        eyebrow={t('organizer.tournaments.wizard.eyebrow')}
        title={t('organizer.tournaments.wizard.title')}
      />

      <ol className="flex items-center gap-2 mt-6 mb-8 text-xs font-medium">
        {STEPS.map((s) => (
          <li
            key={s.n}
            role={s.n < step ? 'button' : undefined}
            tabIndex={s.n < step ? 0 : undefined}
            className={[
              'flex items-center gap-1 px-3 py-1.5 rounded-full',
              s.n === step
                ? 'bg-accent text-accent-foreground'
                : s.n < step
                  ? 'bg-border text-foreground-secondary cursor-pointer'
                  : 'bg-background text-muted',
            ].join(' ')}
            onClick={() => s.n < step && setStep(s.n)}
            onKeyDown={(e) => {
              if (s.n < step && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                setStep(s.n);
              }
            }}
          >
            <span>
              {s.n}/{STEPS.length}
            </span>
            <span>{t(s.key)}</span>
          </li>
        ))}
      </ol>

      <div className="rounded-lg border border-border bg-surface p-6 shadow-sm">
        {step === 1 && (
          <Step1Basics
            eventId={eventId}
            initialTournamentId={tournamentId}
            readOnly={readOnly}
            onCreated={(id) => {
              setTournamentId(id);
              goNext();
            }}
          />
        )}
        {step === 2 && tournamentId && (
          <Step2MatchFormat {...{ tournamentId, readOnly }} onNext={goNext} onBack={goBack} />
        )}
        {step === 3 && tournamentId && (
          <Step3Display {...{ tournamentId, readOnly }} onNext={goNext} onBack={goBack} />
        )}
        {step === 4 && tournamentId && (
          <Step4Advanced
            tournamentId={tournamentId}
            eventId={eventId}
            readOnly={readOnly}
            onBack={goBack}
            onFinish={(publish) => void finish(publish)}
          />
        )}
      </div>

      <button
        type="button"
        onClick={() => router.push(`/org/${slug}/events/${eventId}/tournaments`)}
        className="mt-4 text-xs text-muted hover:text-foreground-secondary"
      >
        {t('actions.cancel')}
      </button>
    </main>
  );
}
