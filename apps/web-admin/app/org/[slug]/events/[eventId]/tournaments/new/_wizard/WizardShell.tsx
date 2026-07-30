'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminPageHeader, useToast } from '@myclash/ui';
import { t } from '@myclash/i18n';
import { Step1Basics } from './Step1Basics';
import { Step2MatchFormat } from './Step2MatchFormat';
import { Step3Display } from './Step3Display';
import { Step4Advanced } from './Step4Advanced';
import { getPublicApiUrl } from '@/lib/api-url';

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
  const router = useRouter();
  const toast = useToast();
  const [tournamentId, setTournamentId] = useState<string | null>(initialTournamentId);
  const [step, setStep] = useState<Step>(initialStep);

  function goNext() {
    if (step < 4) setStep((step + 1) as Step);
  }
  function goBack() {
    if (step > 1) setStep((step - 1) as Step);
  }
  function finish(publish: boolean) {
    if (publish && tournamentId) {
      void fetch(`${getPublicApiUrl()}/api/v1/tournaments/${tournamentId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'published' }),
      });
    }
    toast.success(t('organizer.tournaments.wizard.finishedToast'));
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
            onCreated={(id) => {
              setTournamentId(id);
              goNext();
            }}
          />
        )}
        {step === 2 && tournamentId && (
          <Step2MatchFormat tournamentId={tournamentId} onNext={goNext} onBack={goBack} />
        )}
        {step === 3 && tournamentId && (
          <Step3Display tournamentId={tournamentId} onNext={goNext} onBack={goBack} />
        )}
        {step === 4 && tournamentId && (
          <Step4Advanced
            tournamentId={tournamentId}
            eventId={eventId}
            onBack={goBack}
            onFinish={finish}
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
