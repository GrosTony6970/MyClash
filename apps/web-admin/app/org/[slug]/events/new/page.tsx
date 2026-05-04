/* eslint-disable myclash/no-literal-string -- pre-T-1401 page; i18n strings tracked in backlog */
'use client';

/**
 * New Event wizard — T-701
 * Route: /org/[slug]/events/new
 *
 * 4 steps:
 *   1. Basics (name, slug, dates, location)
 *   2. Lices (number of pistes, names)
 *   3. Theme (primary color, optional logo URL)
 *   4. Review + create
 *
 * AC:
 *   ✓ Wizard creates event, default lices, draft theme
 *   ✓ Validation on each step
 *   ✓ Cancel returns to dashboard with no orphans (nothing created until step 4)
 */

import { useReducer, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

// ── Types ─────────────────────────────────────────────────────────────────────

interface WizardState {
  step: 1 | 2 | 3 | 4;
  // Step 1
  name: string;
  slug: string;
  startDate: string;
  endDate: string;
  location: string;
  // Step 2
  liceCount: number;
  liceNames: string[];
  // Step 3
  primaryColor: string;
  logoUrl: string;
  // Submission
  submitting: boolean;
  error: string | null;
}

type Action =
  | { type: 'SET_FIELD'; field: keyof WizardState; value: unknown }
  | { type: 'SET_LICE_NAME'; index: number; value: string }
  | { type: 'SET_LICE_COUNT'; count: number }
  | { type: 'NEXT' }
  | { type: 'BACK' }
  | { type: 'SUBMIT_START' }
  | { type: 'SUBMIT_ERROR'; error: string };

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function defaultLiceNames(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `Lice ${i + 1}`);
}

const INITIAL: WizardState = {
  step: 1,
  name: '',
  slug: '',
  startDate: '',
  endDate: '',
  location: '',
  liceCount: 2,
  liceNames: ['Lice 1', 'Lice 2'],
  primaryColor: '#c0392b',
  logoUrl: '',
  submitting: false,
  error: null,
};

function reducer(state: WizardState, action: Action): WizardState {
  switch (action.type) {
    case 'SET_FIELD':
      return { ...state, [action.field]: action.value };
    case 'SET_LICE_NAME': {
      const names = [...state.liceNames];
      names[action.index] = action.value;
      return { ...state, liceNames: names };
    }
    case 'SET_LICE_COUNT': {
      const count = Math.max(1, Math.min(10, action.count));
      const names = defaultLiceNames(count).map((def, i) => state.liceNames[i] ?? def);
      return { ...state, liceCount: count, liceNames: names };
    }
    case 'NEXT':
      return { ...state, step: Math.min(4, state.step + 1) as WizardState['step'] };
    case 'BACK':
      return { ...state, step: Math.max(1, state.step - 1) as WizardState['step'] };
    case 'SUBMIT_START':
      return { ...state, submitting: true, error: null };
    case 'SUBMIT_ERROR':
      return { ...state, submitting: false, error: action.error };
    default:
      return state;
  }
}

// ── Validation ────────────────────────────────────────────────────────────────

function validateStep1(s: WizardState): string | null {
  if (!s.name.trim()) return 'Event name is required';
  if (!s.slug.trim() || !/^[a-z0-9-]+$/.test(s.slug))
    return 'Slug must be lowercase letters, digits, and hyphens only';
  if (!s.startDate) return 'Start date is required';
  if (!s.endDate) return 'End date is required';
  if (s.endDate < s.startDate) return 'End date must be on or after start date';
  return null;
}

function validateStep2(s: WizardState): string | null {
  if (s.liceCount < 1) return 'At least 1 Lice is required';
  if (s.liceNames.some((n) => !n.trim())) return 'All Lice names must be filled';
  return null;
}

function validateStep3(_s: WizardState): string | null {
  return null; // theme is optional
}

// ── Step components ───────────────────────────────────────────────────────────

function Step1({ state, dispatch }: { state: WizardState; dispatch: React.Dispatch<Action> }) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <label htmlFor="wizard-event-name" className="block text-sm font-medium text-gray-700 mb-1">
          Event name *
        </label>
        <input
          id="wizard-event-name"
          type="text"
          value={state.name}
          onChange={(e) => {
            dispatch({ type: 'SET_FIELD', field: 'name', value: e.target.value });
            if (!state.slug || state.slug === slugify(state.name)) {
              dispatch({
                type: 'SET_FIELD',
                field: 'slug',
                value: slugify(e.target.value),
              });
            }
          }}
          placeholder="FAL 2027"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
        />
      </div>

      <div>
        <label htmlFor="wizard-event-slug" className="block text-sm font-medium text-gray-700 mb-1">
          URL slug *
        </label>
        <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-red-600">
          <span className="px-3 py-2 bg-gray-50 text-gray-400 text-sm border-r border-gray-300 select-none">
            /e/
          </span>
          <input
            id="wizard-event-slug"
            type="text"
            value={state.slug}
            onChange={(e) =>
              dispatch({
                type: 'SET_FIELD',
                field: 'slug',
                value: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''),
              })
            }
            placeholder="fal-2027"
            className="flex-1 px-3 py-2 text-sm focus:outline-none"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label
            htmlFor="wizard-start-date"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Start date *
          </label>
          <input
            id="wizard-start-date"
            type="date"
            value={state.startDate}
            onChange={(e) =>
              dispatch({ type: 'SET_FIELD', field: 'startDate', value: e.target.value })
            }
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
          />
        </div>
        <div>
          <label htmlFor="wizard-end-date" className="block text-sm font-medium text-gray-700 mb-1">
            End date *
          </label>
          <input
            id="wizard-end-date"
            type="date"
            value={state.endDate}
            min={state.startDate}
            onChange={(e) =>
              dispatch({ type: 'SET_FIELD', field: 'endDate', value: e.target.value })
            }
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
          />
        </div>
      </div>

      <div>
        <label htmlFor="wizard-location" className="block text-sm font-medium text-gray-700 mb-1">
          Location
        </label>
        <input
          id="wizard-location"
          type="text"
          value={state.location}
          onChange={(e) =>
            dispatch({ type: 'SET_FIELD', field: 'location', value: e.target.value })
          }
          placeholder="Lyon, France"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
        />
      </div>
    </div>
  );
}

function Step2({ state, dispatch }: { state: WizardState; dispatch: React.Dispatch<Action> }) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="block text-sm font-medium text-gray-700 mb-1">Number of Lices (pistes)</p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => dispatch({ type: 'SET_LICE_COUNT', count: state.liceCount - 1 })}
            className="w-8 h-8 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 font-bold"
          >
            −
          </button>
          <span className="text-lg font-bold w-8 text-center">{state.liceCount}</span>
          <button
            type="button"
            onClick={() => dispatch({ type: 'SET_LICE_COUNT', count: state.liceCount + 1 })}
            className="w-8 h-8 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 font-bold"
          >
            +
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-gray-700">Lice names</p>
        {state.liceNames.slice(0, state.liceCount).map((name, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-xs text-gray-400 w-6 text-right">{i + 1}.</span>
            <input
              type="text"
              value={name}
              aria-label={`Lice ${i + 1} name`}
              onChange={(e) => dispatch({ type: 'SET_LICE_NAME', index: i, value: e.target.value })}
              className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function Step3({ state, dispatch }: { state: WizardState; dispatch: React.Dispatch<Action> }) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <label
          htmlFor="wizard-primary-color"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Primary color
        </label>
        <div className="flex items-center gap-3">
          <input
            id="wizard-primary-color"
            type="color"
            value={state.primaryColor}
            onChange={(e) =>
              dispatch({ type: 'SET_FIELD', field: 'primaryColor', value: e.target.value })
            }
            className="w-10 h-10 rounded border border-gray-300 cursor-pointer"
          />
          <input
            type="text"
            value={state.primaryColor}
            aria-label="Color hex value"
            onChange={(e) =>
              dispatch({ type: 'SET_FIELD', field: 'primaryColor', value: e.target.value })
            }
            className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-600"
          />
          {/* Live preview */}
          <div
            className="flex-1 h-10 rounded-lg flex items-center justify-center text-white text-sm font-semibold"
            style={{ backgroundColor: state.primaryColor }}
          >
            Preview
          </div>
        </div>
      </div>

      <div>
        <label htmlFor="wizard-logo-url" className="block text-sm font-medium text-gray-700 mb-1">
          Logo URL (optional)
        </label>
        <input
          id="wizard-logo-url"
          type="url"
          value={state.logoUrl}
          onChange={(e) => dispatch({ type: 'SET_FIELD', field: 'logoUrl', value: e.target.value })}
          placeholder="https://example.com/logo.png"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
        />
        <p className="text-xs text-gray-400 mt-1">
          Full logo upload (Supabase Storage) available in the Theme editor after creation.
        </p>
      </div>
    </div>
  );
}

function Step4({ state }: { state: WizardState }) {
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
        <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Event</p>
        <p className="font-semibold text-gray-900">{state.name}</p>
        <p className="text-gray-500 font-mono text-xs mt-0.5">/e/{state.slug}</p>
        <p className="text-gray-500 mt-1">
          {new Date(state.startDate).toLocaleDateString('fr-FR')} –{' '}
          {new Date(state.endDate).toLocaleDateString('fr-FR')}
          {state.location && ` · ${state.location}`}
        </p>
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
        <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">
          Lices ({state.liceCount})
        </p>
        <div className="flex flex-wrap gap-1.5">
          {state.liceNames.slice(0, state.liceCount).map((n, i) => (
            <span key={i} className="text-xs bg-white border border-gray-300 rounded px-2 py-0.5">
              {n}
            </span>
          ))}
        </div>
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
        <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Theme</p>
        <div className="flex items-center gap-2">
          <div
            className="w-6 h-6 rounded border border-gray-300"
            style={{ backgroundColor: state.primaryColor }}
          />
          <span className="font-mono text-xs">{state.primaryColor}</span>
        </div>
      </div>
    </div>
  );
}

// ── Main wizard ───────────────────────────────────────────────────────────────

const STEP_LABELS = ['Basics', 'Lices', 'Theme', 'Review'];

export default function NewEventPage() {
  const params = useParams<{ slug: string }>();
  const { slug } = params;
  const router = useRouter();
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [state, dispatch] = useReducer(reducer, INITIAL);
  const [stepError, setStepError] = useState<string | null>(null);

  function handleNext() {
    let err: string | null = null;
    if (state.step === 1) err = validateStep1(state);
    if (state.step === 2) err = validateStep2(state);
    if (state.step === 3) err = validateStep3(state);
    if (err) {
      setStepError(err);
      return;
    }
    setStepError(null);
    dispatch({ type: 'NEXT' });
  }

  async function handleCreate() {
    dispatch({ type: 'SUBMIT_START' });

    try {
      // 1. Get org id from slug
      const orgRes = await fetch(
        `${apiUrl}/api/v1/organizations/slug/${encodeURIComponent(slug)}`,
        { credentials: 'include' },
      );
      if (!orgRes.ok) throw new Error('Organization not found');
      const org = (await orgRes.json()) as { id: string };

      // 2. Create event
      const eventRes = await fetch(`${apiUrl}/api/v1/organizations/${org.id}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          slug: state.slug,
          name: state.name.trim(),
          startDate: state.startDate,
          endDate: state.endDate,
          location: state.location.trim() || null,
        }),
      });
      if (!eventRes.ok) {
        const body = (await eventRes.json()) as { message?: string };
        throw new Error(body.message ?? 'Failed to create event');
      }
      const event = (await eventRes.json()) as { id: string };

      // 3. Create default lices
      await Promise.all(
        state.liceNames.slice(0, state.liceCount).map((name, i) =>
          fetch(`${apiUrl}/api/v1/events/${event.id}/lices`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ name: name.trim(), sortOrder: i }),
          }),
        ),
      );

      // 4. Create draft theme
      await fetch(`${apiUrl}/api/v1/events/${event.id}/theme`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          primaryColor: state.primaryColor,
          logoUrl: state.logoUrl.trim() || null,
        }),
      });

      // 5. Redirect to event dashboard
      router.push(`/org/${slug}/events/${event.id}`);
    } catch (err) {
      dispatch({
        type: 'SUBMIT_ERROR',
        error: err instanceof Error ? err.message : 'Something went wrong',
      });
    }
  }

  return (
    <main id="main-content" className="p-8 max-w-xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => router.push(`/org/${slug}`)}
          className="text-gray-400 hover:text-gray-600 text-sm"
        >
          ← {slug}
        </button>
        <span className="text-gray-300">/</span>
        <h1 className="text-xl font-bold">New event</h1>
      </div>

      {/* Step indicator */}
      <ol aria-label="Wizard steps" className="flex items-center gap-2 mb-8 list-none p-0 m-0">
        {STEP_LABELS.map((label, i) => {
          const n = i + 1;
          const active = n === state.step;
          const done = n < state.step;
          return (
            <li key={label} className="flex items-center gap-2">
              <div
                aria-current={active ? 'step' : undefined}
                className={[
                  'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold',
                  active
                    ? 'bg-red-700 text-white'
                    : done
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-200 text-gray-500',
                ].join(' ')}
              >
                {done ? (
                  <>
                    <span aria-hidden="true">✓</span>
                    <span className="sr-only">done</span>
                  </>
                ) : (
                  n
                )}
              </div>
              <span
                className={[
                  'text-sm',
                  active ? 'font-semibold text-gray-900' : 'text-gray-400',
                ].join(' ')}
              >
                {label}
              </span>
              {i < STEP_LABELS.length - 1 && (
                <div aria-hidden="true" className="w-6 h-px bg-gray-200 mx-1" />
              )}
            </li>
          );
        })}
      </ol>

      {/* Step content */}
      <div className="mb-6">
        {state.step === 1 && <Step1 state={state} dispatch={dispatch} />}
        {state.step === 2 && <Step2 state={state} dispatch={dispatch} />}
        {state.step === 3 && <Step3 state={state} dispatch={dispatch} />}
        {state.step === 4 && <Step4 state={state} />}
      </div>

      {/* Validation error */}
      {(stepError ?? state.error) && (
        <p className="text-sm text-red-600 mb-4" role="alert">
          {stepError ?? state.error}
        </p>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => {
            if (state.step === 1) {
              router.push(`/org/${slug}`);
            } else {
              setStepError(null);
              dispatch({ type: 'BACK' });
            }
          }}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          {state.step === 1 ? 'Cancel' : '← Back'}
        </button>

        {state.step < 4 ? (
          <button
            onClick={handleNext}
            className="bg-red-700 hover:bg-red-800 text-white font-semibold py-2 px-6 rounded-lg text-sm transition-colors"
          >
            Next →
          </button>
        ) : (
          <button
            onClick={() => void handleCreate()}
            disabled={state.submitting}
            aria-busy={state.submitting || undefined}
            className="bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold py-2 px-6 rounded-lg text-sm transition-colors"
          >
            {state.submitting ? 'Creating…' : 'Create event'}
          </button>
        )}
      </div>
    </main>
  );
}
