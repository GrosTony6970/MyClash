'use client';

/**
 * Onboarding page — T-603
 * Route: /e/[eventSlug]/onboarding
 *
 * Flow:
 *   1. Name lookup (PersonLookup component)
 *   2. Confirm selection → POST /guest-sessions → cookie set
 *   3. Redirect to persona selection
 *
 * If already a known guest (mc_guest cookie present), skip to persona selection.
 * Mobile-first, one-handed use.
 */

import { useEffect, useReducer } from 'react';
import { getApiUrl } from '@/lib/api-url';
import { useRouter } from 'next/navigation';
import { PersonLookup, type PersonMatch } from '../../../../src/components/PersonLookup';
import { useI18n } from '../../../../src/i18n/I18nProvider';

// ── State machine ─────────────────────────────────────────────────────────────

type Step = 'lookup' | 'confirm' | 'creating_session' | 'not_in_list' | 'error';

interface State {
  step: Step;
  selected: PersonMatch | null;
  error: string | null;
}

type Action =
  | { type: 'SELECT'; person: PersonMatch }
  | { type: 'BACK' }
  | { type: 'NOT_IN_LIST' }
  | { type: 'CREATING' }
  | { type: 'ERROR'; error: string };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SELECT':
      return { ...state, step: 'confirm', selected: action.person, error: null };
    case 'BACK':
      return { ...state, step: 'lookup', selected: null, error: null };
    case 'NOT_IN_LIST':
      return { ...state, step: 'not_in_list', error: null };
    case 'CREATING':
      return { ...state, step: 'creating_session', error: null };
    case 'ERROR':
      return { ...state, step: 'confirm', error: action.error };
    default:
      return state;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  params: Promise<{ eventSlug: string }>;
  searchParams: Promise<{ eventId?: string }>;
}

export default function OnboardingPage({ params, searchParams }: Props) {
  const { t } = useI18n();
  const router = useRouter();
  const [eventSlug, setEventSlug] = React.useState<string | null>(null);
  const [eventId, setEventId] = React.useState<string | null>(null);
  const apiUrl = getApiUrl();

  const [state, dispatch] = useReducer(reducer, {
    step: 'lookup',
    selected: null,
    error: null,
  });

  // Resolve params
  useEffect(() => {
    void params.then(({ eventSlug: slug }) => setEventSlug(slug));
    void searchParams.then(({ eventId: id }) => setEventId(id ?? null));
  }, [params, searchParams]);

  // Check for existing guest session → skip to persona
  useEffect(() => {
    if (!eventSlug) return;
    // If mc_guest cookie exists, redirect straight to persona selection
    const hasCookie = document.cookie.includes('mc_guest=');
    if (hasCookie) {
      router.replace(`/e/${eventSlug}/onboarding/persona`);
    }
  }, [eventSlug, router]);

  async function handleConfirm() {
    if (!state.selected || !eventId) return;
    dispatch({ type: 'CREATING' });

    try {
      const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/guest-sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ person_id: state.selected.id }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { message?: string };
        dispatch({ type: 'ERROR', error: data.message ?? t('publicApp.onboarding.sessionFailed') });
        return;
      }

      // Cookie set by server — redirect to persona selection
      router.push(`/e/${eventSlug}/onboarding/persona`);
    } catch {
      dispatch({ type: 'ERROR', error: t('publicApp.onboarding.networkError') });
    }
  }

  if (!eventSlug) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <span className="w-8 h-8 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col px-4 py-8 max-w-md mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1
          className="font-display font-bold text-2xl sm:text-3xl mb-2"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--event-primary, #c0392b)' }}
        >
          {t('publicApp.onboarding.welcome')}
        </h1>
        <p className="text-gray-400">{t('publicApp.onboarding.findYourself')}</p>
      </div>

      {/* ── Step: Lookup ── */}
      {state.step === 'lookup' && (
        <PersonLookup
          eventId={eventId ?? ''}
          apiUrl={apiUrl}
          onSelect={(person) => dispatch({ type: 'SELECT', person })}
          onNotInList={() => dispatch({ type: 'NOT_IN_LIST' })}
        />
      )}

      {/* ── Step: Confirm ── */}
      {(state.step === 'confirm' || state.step === 'creating_session') && state.selected && (
        <div className="flex flex-col gap-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
              {t('publicApp.onboarding.youSelected')}
            </p>
            <p className="text-xl font-bold text-white">
              {state.selected.given_name} {state.selected.family_name}
            </p>
            {state.selected.club_label && (
              <p className="text-gray-400 text-sm mt-0.5">{state.selected.club_label}</p>
            )}
            <p className="font-mono text-xs text-gray-500 mt-1">{state.selected.masked_email}</p>
          </div>

          <p className="text-sm text-gray-400">
            {t('publicApp.onboarding.isThisYouPrefix')}{' '}
            <strong className="text-white">{t('publicApp.onboarding.yesThatsMe')}</strong>{' '}
            {t('publicApp.onboarding.isThisYouSuffix')}
          </p>

          {state.error && (
            <p className="text-sm text-red-400" role="alert">
              {state.error}
            </p>
          )}

          <button
            onClick={() => void handleConfirm()}
            disabled={state.step === 'creating_session'}
            className="w-full py-4 rounded-xl font-bold text-lg text-white transition-colors
                         disabled:opacity-50"
            style={{ backgroundColor: 'var(--event-primary, #c0392b)' }}
          >
            {state.step === 'creating_session'
              ? t('publicApp.onboarding.settingUp')
              : t('publicApp.onboarding.yesThatsMe')}
          </button>

          <button
            onClick={() => dispatch({ type: 'BACK' })}
            disabled={state.step === 'creating_session'}
            className="w-full py-3 rounded-xl font-medium text-gray-400 hover:text-white
                         border border-gray-700 hover:border-gray-500 transition-colors"
          >
            {t('publicApp.onboarding.searchAgain')}
          </button>
        </div>
      )}

      {/* ── Step: Not in list ── */}
      {state.step === 'not_in_list' && (
        <div className="flex flex-col gap-6">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
            <p className="text-gray-300 leading-relaxed italic">
              {t('publicApp.onboarding.notInListBody')}
            </p>
          </div>
          <button
            onClick={() => dispatch({ type: 'BACK' })}
            className="text-sm text-gray-500 hover:text-gray-300 underline self-start"
          >
            {t('publicApp.onboarding.trySearchingAgain')}
          </button>
        </div>
      )}
    </main>
  );
}

// React import needed for useState in client component
import React from 'react';
