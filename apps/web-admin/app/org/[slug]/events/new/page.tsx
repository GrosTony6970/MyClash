'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@myclash/ui';
import { IsoDatePicker } from '../../../../../src/components/IsoDatePicker';
import { useI18n } from '../../../../../src/i18n/I18nProvider';
import { useOrganizerSelectedEvent } from '../../../../../src/components/organizer-event-context';

interface WizardState {
  step: 1 | 2 | 3 | 4;
  name: string;
  slug: string;
  startDate: string;
  endDate: string;
  location: string;
  liceCount: number;
  liceNames: string[];
  logoUrl: string;
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

const MAX_LOGO_BYTES = 10 * 1024 * 1024;
const ALLOWED_LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

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
  logoUrl: '',
  submitting: false,
  error: null,
};

function reducer(state: WizardState, action: Action): WizardState {
  switch (action.type) {
    case 'SET_FIELD':
      if (action.field === 'startDate' && typeof action.value === 'string') {
        return {
          ...state,
          startDate: action.value,
          endDate: !state.endDate || state.endDate < action.value ? action.value : state.endDate,
        };
      }
      return { ...state, [action.field]: action.value };
    case 'SET_LICE_NAME': {
      const names = [...state.liceNames];
      names[action.index] = action.value;
      return { ...state, liceNames: names };
    }
    case 'SET_LICE_COUNT': {
      const count = Math.max(1, Math.min(10, action.count));
      const names = defaultLiceNames(count).map(
        (fallback, index) => state.liceNames[index] ?? fallback,
      );
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

function validateStep1(s: WizardState, t: (key: string) => string): string | null {
  if (!s.name.trim()) return t('organizer.newEvent.validation.nameRequired');
  if (!s.slug.trim() || !/^[a-z0-9-]+$/u.test(s.slug)) {
    return t('organizer.newEvent.validation.invalidSlug');
  }
  if (!s.startDate) return t('organizer.newEvent.validation.startRequired');
  if (!s.endDate) return t('organizer.newEvent.validation.endRequired');
  if (s.endDate < s.startDate) return t('organizer.newEvent.validation.endBeforeStart');
  return null;
}

function validateStep2(s: WizardState, t: (key: string) => string): string | null {
  if (s.liceCount < 1) return t('organizer.newEvent.validation.licesRequired');
  if (s.liceNames.some((name) => !name.trim())) {
    return t('organizer.newEvent.validation.licesNamesRequired');
  }
  return null;
}

type Translator = (key: string, values?: Record<string, string | number>) => string;

function Step1({
  state,
  dispatch,
  t,
  locale,
}: {
  state: WizardState;
  dispatch: React.Dispatch<Action>;
  t: Translator;
  locale: string;
}) {
  const weekdayLabels = t('organizer.newEvent.weekdays').split('|');

  return (
    <div className="flex flex-col gap-5">
      <div>
        <label htmlFor="wizard-event-name" className="mb-1 block text-sm font-medium text-gray-700">
          {t('organizer.newEvent.eventName')}
        </label>
        <input
          id="wizard-event-name"
          type="text"
          value={state.name}
          onChange={(event) => {
            dispatch({ type: 'SET_FIELD', field: 'name', value: event.target.value });
            if (!state.slug || state.slug === slugify(state.name)) {
              dispatch({ type: 'SET_FIELD', field: 'slug', value: slugify(event.target.value) });
            }
          }}
          placeholder={t('organizer.newEvent.eventNamePlaceholder')}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
        />
      </div>

      <div>
        <label htmlFor="wizard-event-slug" className="mb-1 block text-sm font-medium text-gray-700">
          {t('organizer.newEvent.slug')}
        </label>
        <div className="flex items-center overflow-hidden rounded-lg border border-gray-300 focus-within:ring-2 focus-within:ring-red-600">
          <span className="select-none border-r border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-400">
            {t('organizer.newEvent.slugPrefix')}
          </span>
          <input
            id="wizard-event-slug"
            type="text"
            value={state.slug}
            onChange={(event) =>
              dispatch({
                type: 'SET_FIELD',
                field: 'slug',
                value: event.target.value.toLowerCase().replace(/[^a-z0-9-]/gu, ''),
              })
            }
            placeholder={t('organizer.newEvent.slugPlaceholder')}
            className="flex-1 px-3 py-2 text-sm focus:outline-none"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <IsoDatePicker
          id="wizard-start-date"
          label={t('organizer.newEvent.startDate')}
          value={state.startDate}
          onChange={(value) => dispatch({ type: 'SET_FIELD', field: 'startDate', value })}
          locale={locale}
          previousMonthLabel={t('organizer.newEvent.previousMonth')}
          nextMonthLabel={t('organizer.newEvent.nextMonth')}
          weekdayLabels={weekdayLabels}
        />
        <IsoDatePicker
          id="wizard-end-date"
          label={t('organizer.newEvent.endDate')}
          value={state.endDate}
          min={state.startDate}
          onChange={(value) => dispatch({ type: 'SET_FIELD', field: 'endDate', value })}
          locale={locale}
          previousMonthLabel={t('organizer.newEvent.previousMonth')}
          nextMonthLabel={t('organizer.newEvent.nextMonth')}
          weekdayLabels={weekdayLabels}
        />
      </div>

      <div>
        <label htmlFor="wizard-location" className="mb-1 block text-sm font-medium text-gray-700">
          {t('organizer.newEvent.location')}
        </label>
        <input
          id="wizard-location"
          type="text"
          value={state.location}
          onChange={(event) =>
            dispatch({ type: 'SET_FIELD', field: 'location', value: event.target.value })
          }
          placeholder={t('organizer.newEvent.locationPlaceholder')}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
        />
      </div>
    </div>
  );
}

function Step2({
  state,
  dispatch,
  t,
}: {
  state: WizardState;
  dispatch: React.Dispatch<Action>;
  t: Translator;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="mb-1 block text-sm font-medium text-gray-700">
          {t('organizer.newEvent.licesCount')}
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => dispatch({ type: 'SET_LICE_COUNT', count: state.liceCount - 1 })}
            className="h-8 w-8 rounded-lg border border-gray-300 font-bold text-gray-600 hover:bg-gray-50"
          >
            -
          </button>
          <span className="w-8 text-center text-lg font-bold">{state.liceCount}</span>
          <button
            type="button"
            onClick={() => dispatch({ type: 'SET_LICE_COUNT', count: state.liceCount + 1 })}
            className="h-8 w-8 rounded-lg border border-gray-300 font-bold text-gray-600 hover:bg-gray-50"
          >
            +
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-gray-700">{t('organizer.newEvent.licesNames')}</p>
        {state.liceNames.slice(0, state.liceCount).map((name, index) => (
          <div key={index} className="flex items-center gap-2">
            <span className="w-6 text-right text-xs text-gray-400">{index + 1}.</span>
            <input
              type="text"
              value={name}
              aria-label={t('organizer.newEvent.liceName', { number: index + 1 })}
              onChange={(event) =>
                dispatch({ type: 'SET_LICE_NAME', index, value: event.target.value })
              }
              className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function Step3({
  state,
  dispatch,
  t,
  logoPreviewUrl,
  onLogoChange,
}: {
  state: WizardState;
  dispatch: React.Dispatch<Action>;
  t: Translator;
  logoPreviewUrl: string | null;
  onLogoChange: (file: File | null) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <label htmlFor="wizard-logo-url" className="mb-1 block text-sm font-medium text-gray-700">
          {t('organizer.newEvent.logoUrl')}
        </label>
        <input
          id="wizard-logo-url"
          type="url"
          value={state.logoUrl}
          onChange={(event) =>
            dispatch({ type: 'SET_FIELD', field: 'logoUrl', value: event.target.value })
          }
          placeholder={t('organizer.newEvent.logoUrlPlaceholder')}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
        />
        <div className="mt-3 flex flex-col gap-3">
          <input
            id="wizard-logo-file"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => onLogoChange(event.target.files?.[0] ?? null)}
            className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-slate-800"
          />
          <p className="text-xs text-gray-400">{t('organizer.newEvent.logoHelp')}</p>
          {logoPreviewUrl && (
            <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logoPreviewUrl}
                alt={t('organizer.newEvent.logoPreviewAlt')}
                className="h-12 w-12 rounded bg-white object-contain p-1"
              />
              <span className="text-xs text-gray-500">{t('organizer.newEvent.logoUpload')}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Step4({
  state,
  t,
  logoPreviewUrl,
}: {
  state: WizardState;
  t: Translator;
  logoPreviewUrl: string | null;
}) {
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
        <p className="mb-2 text-xs uppercase tracking-wide text-gray-500">
          {t('organizer.newEvent.reviewEvent')}
        </p>
        <p className="font-semibold text-gray-900">{state.name}</p>
        <p className="mt-0.5 font-mono text-xs text-gray-500">/e/{state.slug}</p>
        <p className="mt-1 text-gray-500">
          {state.startDate} - {state.endDate}
          {state.location ? ` - ${state.location}` : ''}
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
        <p className="mb-2 text-xs uppercase tracking-wide text-gray-500">
          {t('organizer.newEvent.reviewLices', { count: state.liceCount })}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {state.liceNames.slice(0, state.liceCount).map((name, index) => (
            <span
              key={index}
              className="rounded border border-gray-300 bg-white px-2 py-0.5 text-xs"
            >
              {name}
            </span>
          ))}
        </div>
      </div>

      {logoPreviewUrl && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <p className="mb-2 text-xs uppercase tracking-wide text-gray-500">
            {t('organizer.newEvent.reviewTheme')}
          </p>
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logoPreviewUrl}
              alt={t('organizer.newEvent.logoPreviewAlt')}
              className="h-10 w-10 rounded bg-white object-contain"
            />
            <span className="text-xs text-gray-500">{t('organizer.newEvent.logoUpload')}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function NewEventPage() {
  const params = useParams<{ slug: string }>();
  const { slug } = params;
  const router = useRouter();
  // Mark the freshly-created event as selected before navigating so the
  // shell's event switcher and any localStorage-backed defaults reflect it
  // immediately, instead of waiting for the next page's URL-effect to run.
  const { selectEvent } = useOrganizerSelectedEvent();
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
  const { locale, t } = useI18n();

  const [state, dispatch] = useReducer(reducer, INITIAL);
  const [stepError, setStepError] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const logoPreviewRef = useRef<string | null>(null);
  const stepLabels = [
    t('organizer.newEvent.steps.basics'),
    t('organizer.newEvent.steps.lices'),
    t('organizer.newEvent.steps.theme'),
    t('organizer.newEvent.steps.review'),
  ];

  useEffect(
    () => () => {
      if (logoPreviewRef.current) URL.revokeObjectURL(logoPreviewRef.current);
    },
    [],
  );

  function setLogoPreview(file: File | null) {
    if (logoPreviewRef.current) URL.revokeObjectURL(logoPreviewRef.current);
    if (!file) {
      logoPreviewRef.current = null;
      setLogoPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    logoPreviewRef.current = url;
    setLogoPreviewUrl(url);
  }

  function handleLogoChange(file: File | null) {
    if (!file) {
      setLogoFile(null);
      setLogoPreview(null);
      return;
    }
    if (!ALLOWED_LOGO_TYPES.has(file.type)) {
      setStepError(t('organizer.newEvent.validation.logoType'));
      setLogoFile(null);
      setLogoPreview(null);
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setStepError(t('organizer.newEvent.validation.logoSize'));
      setLogoFile(null);
      setLogoPreview(null);
      return;
    }
    setStepError(null);
    setLogoFile(file);
    setLogoPreview(file);
  }

  function handleNext() {
    let err: string | null = null;
    if (state.step === 1) err = validateStep1(state, t);
    if (state.step === 2) err = validateStep2(state, t);
    if (state.step === 3) err = null;
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
      const orgRes = await fetch(
        `${apiUrl}/api/v1/organizations/slug/${encodeURIComponent(slug)}`,
        { credentials: 'include' },
      );
      if (!orgRes.ok) throw new Error(t('organizer.newEvent.validation.organizationNotFound'));
      const org = (await orgRes.json()) as { id: string };

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
        throw new Error(body.message ?? t('organizer.newEvent.validation.createFailed'));
      }
      const event = (await eventRes.json()) as { id: string };

      await Promise.all(
        state.liceNames.slice(0, state.liceCount).map((name, index) =>
          fetch(`${apiUrl}/api/v1/events/${event.id}/lices`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ name: name.trim(), sortOrder: index }),
          }),
        ),
      );

      const pastedLogoUrl = state.logoUrl.trim() || null;
      if (logoFile) {
        // Canonical events-level endpoint: writes to storage AND
        // events.logo_url. (Theme retired its own logo column in
        // migration 0084.)
        const formData = new FormData();
        formData.append('file', logoFile);
        const logoRes = await fetch(`${apiUrl}/api/v1/events/${event.id}/logo`, {
          method: 'POST',
          credentials: 'include',
          body: formData,
        });
        if (!logoRes.ok) {
          selectEvent(event.id);
          router.push(`/org/${slug}/events/${event.id}/theme?logoUpload=failed`);
          return;
        }
      } else if (pastedLogoUrl) {
        // Operator pasted a URL instead of uploading a file —
        // mirror it onto events.logo_url via the theme upsert
        // (which now routes logoUrl to the events column).
        await fetch(`${apiUrl}/api/v1/events/${event.id}/theme`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ logoUrl: pastedLogoUrl }),
        });
      }

      // Per-event color overrides retired in migration 0086 — the
      // primary color used to write to themes.primary_color. No-op
      // here now; the Branding page handles logo + hero post-create.

      selectEvent(event.id);
      router.push(`/org/${slug}/events/${event.id}`);
    } catch (err) {
      dispatch({
        type: 'SUBMIT_ERROR',
        error: err instanceof Error ? err.message : t('organizer.newEvent.validation.generic'),
      });
    }
  }

  return (
    <main id="main-content" className="max-w-xl p-8">
      <div className="mb-6 flex items-center gap-3">
        <Button type="button" variant="back" size="sm" onClick={() => router.push(`/org/${slug}`)}>
          {t('organizer.newEvent.backToOrg', { slug })}
        </Button>
        <span className="text-gray-300">/</span>
        <h1 className="text-xl font-bold">{t('organizer.newEvent.title')}</h1>
      </div>

      <ol
        aria-label={t('organizer.newEvent.stepsLabel')}
        className="mb-8 flex list-none items-center gap-2 p-0"
      >
        {stepLabels.map((label, index) => {
          const stepNumber = index + 1;
          const active = stepNumber === state.step;
          const done = stepNumber < state.step;
          return (
            <li key={label} className="flex items-center gap-2">
              <div
                aria-current={active ? 'step' : undefined}
                className={[
                  'flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold',
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
                    <span className="sr-only">{t('organizer.newEvent.done')}</span>
                  </>
                ) : (
                  stepNumber
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
              {index < stepLabels.length - 1 && (
                <div aria-hidden="true" className="mx-1 h-px w-6 bg-gray-200" />
              )}
            </li>
          );
        })}
      </ol>

      <div className="mb-6">
        {state.step === 1 && <Step1 state={state} dispatch={dispatch} t={t} locale={locale} />}
        {state.step === 2 && <Step2 state={state} dispatch={dispatch} t={t} />}
        {state.step === 3 && (
          <Step3
            state={state}
            dispatch={dispatch}
            t={t}
            logoPreviewUrl={logoPreviewUrl}
            onLogoChange={handleLogoChange}
          />
        )}
        {state.step === 4 && <Step4 state={state} t={t} logoPreviewUrl={logoPreviewUrl} />}
      </div>

      {(stepError ?? state.error) && (
        <p className="mb-4 text-sm text-red-600" role="alert">
          {stepError ?? state.error}
        </p>
      )}

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant={state.step === 1 ? 'cancel' : 'back'}
          onClick={() => {
            if (state.step === 1) {
              router.push(`/org/${slug}`);
            } else {
              setStepError(null);
              dispatch({ type: 'BACK' });
            }
          }}
        >
          {state.step === 1 ? t('organizer.newEvent.cancel') : t('organizer.newEvent.back')}
        </Button>

        {state.step < 4 ? (
          <Button type="button" variant="next" onClick={handleNext}>
            {t('organizer.newEvent.next')}
          </Button>
        ) : (
          <Button
            type="button"
            variant="next"
            onClick={() => void handleCreate()}
            disabled={state.submitting}
            loading={state.submitting}
          >
            {state.submitting ? t('organizer.newEvent.creating') : t('organizer.newEvent.create')}
          </Button>
        )}
      </div>
    </main>
  );
}
