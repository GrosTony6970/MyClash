'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button, CountryCombobox, formatCountryName } from '@myclash/ui';
import { EVENT_KINDS, DEFAULT_EVENT_KIND, type EventKind } from '@myclash/types';
import { IsoDatePicker } from '../../../../../src/components/IsoDatePicker';
import { useI18n } from '@myclash/next-i18n/client';
import { useOrganizerSelectedEvent } from '../../../../../src/components/organizer-event-context';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';

interface CatalogueVenue {
  id: string;
  name: string;
  address: string | null;
  hosts_tournament: boolean;
  hosts_workshop: boolean;
  // Reusable per-venue catalogues — pre-fill the event's lices/areas when this
  // venue is picked.
  venue_lices?: Array<{ id: string; name: string }> | null;
  venue_areas?: Array<{ id: string; name: string }> | null;
}

type VenueMode = 'existing' | 'new';

interface WizardState {
  step: 1 | 2 | 3 | 4;
  name: string;
  slug: string;
  startDate: string;
  endDate: string;
  city: string;
  country: string | null;
  venueMode: VenueMode;
  selectedVenueId: string | null;
  newVenueName: string;
  newVenueAddress: string;
  newVenueHostsTournament: boolean;
  newVenueHostsWorkshop: boolean;
  liceNames: string[];
  areaNames: string[];
  logoUrl: string;
  eventKind: EventKind;
  submitting: boolean;
  error: string | null;
}

type Action =
  | { type: 'SET_FIELD'; field: keyof WizardState; value: unknown }
  | { type: 'SET_LICE_NAME'; index: number; value: string }
  | { type: 'ADD_LICE' }
  | { type: 'REMOVE_LICE'; index: number }
  | { type: 'SET_AREA_NAME'; index: number; value: string }
  | { type: 'ADD_AREA' }
  | { type: 'REMOVE_AREA'; index: number }
  | { type: 'SET_VENUE_MODE'; mode: VenueMode }
  | {
      type: 'SELECT_VENUE';
      venueId: string | null;
      liceNames: string[] | null;
      areaNames: string[] | null;
    }
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

const INITIAL: WizardState = {
  step: 1,
  name: '',
  slug: '',
  startDate: '',
  endDate: '',
  city: '',
  country: null,
  venueMode: 'new',
  selectedVenueId: null,
  newVenueName: '',
  newVenueAddress: '',
  newVenueHostsTournament: true,
  newVenueHostsWorkshop: false,
  liceNames: ['Lice 1', 'Lice 2'],
  areaNames: [],
  logoUrl: '',
  eventKind: DEFAULT_EVENT_KIND,
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
    case 'ADD_LICE': {
      if (state.liceNames.length >= 12) return state;
      const next = `Lice ${state.liceNames.length + 1}`;
      return { ...state, liceNames: [...state.liceNames, next] };
    }
    case 'REMOVE_LICE': {
      const names = state.liceNames.filter((_, idx) => idx !== action.index);
      return { ...state, liceNames: names };
    }
    case 'SET_AREA_NAME': {
      const names = [...state.areaNames];
      names[action.index] = action.value;
      return { ...state, areaNames: names };
    }
    case 'ADD_AREA': {
      if (state.areaNames.length >= 12) return state;
      const next = `Area ${state.areaNames.length + 1}`;
      return { ...state, areaNames: [...state.areaNames, next] };
    }
    case 'REMOVE_AREA': {
      const names = state.areaNames.filter((_, idx) => idx !== action.index);
      return { ...state, areaNames: names };
    }
    case 'SET_VENUE_MODE':
      return {
        ...state,
        venueMode: action.mode,
        selectedVenueId: action.mode === 'existing' ? state.selectedVenueId : null,
      };
    case 'SELECT_VENUE':
      // Picking a venue pre-fills the event's lices/areas from the venue's
      // reusable catalogue when it has one; otherwise the current names stay
      // (operator can still edit).
      return {
        ...state,
        selectedVenueId: action.venueId,
        liceNames:
          action.liceNames && action.liceNames.length > 0 ? action.liceNames : state.liceNames,
        areaNames:
          action.areaNames && action.areaNames.length > 0 ? action.areaNames : state.areaNames,
      };
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

function validateStep2(
  s: WizardState,
  catalogue: CatalogueVenue[],
  t: (key: string) => string,
): string | null {
  const picked =
    s.venueMode === 'existing' ? (catalogue.find((v) => v.id === s.selectedVenueId) ?? null) : null;
  const hostsTournament =
    s.venueMode === 'new' ? s.newVenueHostsTournament : (picked?.hosts_tournament ?? false);
  const hostsWorkshop =
    s.venueMode === 'new' ? s.newVenueHostsWorkshop : (picked?.hosts_workshop ?? false);

  if (s.venueMode === 'existing' && !picked) {
    return t('organizer.newEvent.validation.venueRequired');
  }
  if (s.venueMode === 'new') {
    if (!s.newVenueName.trim()) return t('organizer.newEvent.validation.venueNameRequired');
    if (!hostsTournament && !hostsWorkshop) {
      return t('organizer.newEvent.validation.venueCapabilityRequired');
    }
  }
  if (hostsTournament) {
    if (s.liceNames.length < 1) return t('organizer.newEvent.validation.licesRequired');
    if (s.liceNames.some((name) => !name.trim())) {
      return t('organizer.newEvent.validation.licesNamesRequired');
    }
  }
  if (hostsWorkshop && s.areaNames.some((name) => !name.trim())) {
    return t('organizer.newEvent.validation.areaNamesRequired');
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
        <label
          htmlFor="wizard-event-name"
          className="mb-1 block text-sm font-medium text-foreground-secondary"
        >
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
          className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      <div>
        <label
          htmlFor="wizard-event-slug"
          className="mb-1 block text-sm font-medium text-foreground-secondary"
        >
          {t('organizer.newEvent.slug')}
        </label>
        <div className="flex items-center overflow-hidden rounded-lg border border-border focus-within:ring-2 focus-within:ring-accent">
          <span className="select-none border-r border-border bg-background px-3 py-2 text-sm text-muted">
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

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label
            htmlFor="wizard-city"
            className="mb-1 block text-sm font-medium text-foreground-secondary"
          >
            {t('organizer.newEvent.city')}
          </label>
          <input
            id="wizard-city"
            type="text"
            value={state.city}
            onChange={(event) =>
              dispatch({ type: 'SET_FIELD', field: 'city', value: event.target.value })
            }
            placeholder={t('organizer.newEvent.cityPlaceholder')}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <div>
          <label
            htmlFor="wizard-country"
            className="mb-1 block text-sm font-medium text-foreground-secondary"
          >
            {t('organizer.newEvent.country')}
          </label>
          <CountryCombobox
            id="wizard-country"
            value={state.country}
            onChange={(code) => dispatch({ type: 'SET_FIELD', field: 'country', value: code })}
            locale={locale}
            placeholder={t('organizer.newEvent.countryPlaceholder')}
          />
        </div>
      </div>

      <fieldset className="rounded-lg border border-border bg-background p-3">
        <legend className="px-1 text-sm font-medium text-foreground">
          {t('organizer.newEvent.eventKind')}
        </legend>
        <div className="space-y-2.5">
          {EVENT_KINDS.map((kind) => (
            <label
              key={kind}
              className="flex items-start gap-2.5 text-sm text-foreground-secondary"
            >
              <input
                type="radio"
                name="event-kind"
                value={kind}
                checked={state.eventKind === kind}
                onChange={() => dispatch({ type: 'SET_FIELD', field: 'eventKind', value: kind })}
                className="mt-0.5 h-4 w-4 border-border text-accent focus:ring-accent"
              />
              <span>
                <span className="font-medium text-foreground">
                  {t(`organizer.newEvent.kinds.${kind}`)}
                </span>
                <span className="mt-0.5 block text-xs text-muted">
                  {t(`organizer.newEvent.kindHelp.${kind}`)}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

function Step2({
  state,
  dispatch,
  t,
  catalogue,
  catalogueLoading,
}: {
  state: WizardState;
  dispatch: React.Dispatch<Action>;
  t: Translator;
  catalogue: CatalogueVenue[];
  catalogueLoading: boolean;
}) {
  const pickedVenue =
    state.venueMode === 'existing'
      ? (catalogue.find((v) => v.id === state.selectedVenueId) ?? null)
      : null;
  const hostsTournament =
    state.venueMode === 'new'
      ? state.newVenueHostsTournament
      : (pickedVenue?.hosts_tournament ?? false);
  const hostsWorkshop =
    state.venueMode === 'new'
      ? state.newVenueHostsWorkshop
      : (pickedVenue?.hosts_workshop ?? false);

  return (
    <div className="flex flex-col gap-5">
      <div role="tablist" className="flex gap-1 rounded-lg bg-border p-1 text-sm font-medium">
        <button
          type="button"
          role="tab"
          aria-selected={state.venueMode === 'existing'}
          onClick={() => dispatch({ type: 'SET_VENUE_MODE', mode: 'existing' })}
          className={[
            'flex-1 rounded-md px-3 py-1.5 transition-colors',
            state.venueMode === 'existing'
              ? 'bg-surface text-foreground shadow-sm'
              : 'text-muted hover:text-foreground-secondary',
          ].join(' ')}
        >
          {t('organizer.newEvent.venuePickExisting')}
        </button>
        <button
          type="button"
          role="tab"
          data-testid="venue-mode-new"
          aria-selected={state.venueMode === 'new'}
          onClick={() => dispatch({ type: 'SET_VENUE_MODE', mode: 'new' })}
          className={[
            'flex-1 rounded-md px-3 py-1.5 transition-colors',
            state.venueMode === 'new'
              ? 'bg-surface text-foreground shadow-sm'
              : 'text-muted hover:text-foreground-secondary',
          ].join(' ')}
        >
          {t('organizer.newEvent.venueCreateNew')}
        </button>
      </div>

      {state.venueMode === 'existing' ? (
        <div className="flex flex-col gap-2">
          <label
            htmlFor="wizard-venue-select"
            className="text-sm font-medium text-foreground-secondary"
          >
            {t('organizer.newEvent.venuePickLabel')}
          </label>
          {catalogueLoading ? (
            <p className="text-xs text-muted">{t('organizer.newEvent.venueLoading')}</p>
          ) : catalogue.length === 0 ? (
            <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
              {t('organizer.newEvent.venueCatalogueEmpty')}
            </div>
          ) : (
            <select
              id="wizard-venue-select"
              value={state.selectedVenueId ?? ''}
              onChange={(event) => {
                const picked = catalogue.find((v) => v.id === event.target.value);
                dispatch({
                  type: 'SELECT_VENUE',
                  venueId: event.target.value || null,
                  liceNames: picked?.venue_lices?.map((l) => l.name) ?? null,
                  areaNames: picked?.venue_areas?.map((a) => a.name) ?? null,
                });
              }}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="">{t('organizer.newEvent.venuePickPlaceholder')}</option>
              {catalogue.map((venue) => (
                <option key={venue.id} value={venue.id}>
                  {venue.name}
                  {venue.address ? ` — ${venue.address}` : ''}
                </option>
              ))}
            </select>
          )}
          {pickedVenue && (
            <div className="flex flex-wrap gap-1.5 text-xs">
              {pickedVenue.hosts_tournament && (
                <span className="rounded-full bg-blue-100 px-2 py-0.5 font-semibold text-blue-700">
                  {t('organizer.venues.tournamentBadge')}
                </span>
              )}
              {pickedVenue.hosts_workshop && (
                <span className="rounded-full bg-green-100 px-2 py-0.5 font-semibold text-green-700">
                  {t('organizer.venues.workshopBadge')}
                </span>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div>
            <label
              htmlFor="wizard-venue-name"
              className="mb-1 block text-sm font-medium text-foreground-secondary"
            >
              {t('organizer.newEvent.venueName')}
            </label>
            <input
              id="wizard-venue-name"
              type="text"
              value={state.newVenueName}
              onChange={(event) =>
                dispatch({ type: 'SET_FIELD', field: 'newVenueName', value: event.target.value })
              }
              placeholder={t('organizer.newEvent.venueNamePlaceholder')}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div>
            <label
              htmlFor="wizard-venue-address"
              className="mb-1 block text-sm font-medium text-foreground-secondary"
            >
              {t('organizer.newEvent.venueAddress')}
            </label>
            <input
              id="wizard-venue-address"
              type="text"
              value={state.newVenueAddress}
              onChange={(event) =>
                dispatch({
                  type: 'SET_FIELD',
                  field: 'newVenueAddress',
                  value: event.target.value,
                })
              }
              placeholder={t('organizer.newEvent.venueAddressPlaceholder')}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <fieldset className="flex flex-wrap gap-4">
            <legend className="mb-1 text-sm font-medium text-foreground-secondary">
              {t('organizer.newEvent.venueCapabilities')}
            </legend>
            <label className="flex items-center gap-2 text-sm text-foreground-secondary">
              <input
                type="checkbox"
                data-testid="venue-hosts-tournament"
                checked={state.newVenueHostsTournament}
                onChange={(event) =>
                  dispatch({
                    type: 'SET_FIELD',
                    field: 'newVenueHostsTournament',
                    value: event.target.checked,
                  })
                }
                className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
              />
              {t('organizer.venues.hostsTournament')}
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground-secondary">
              <input
                type="checkbox"
                checked={state.newVenueHostsWorkshop}
                onChange={(event) =>
                  dispatch({
                    type: 'SET_FIELD',
                    field: 'newVenueHostsWorkshop',
                    value: event.target.checked,
                  })
                }
                className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
              />
              {t('organizer.venues.hostsWorkshop')}
            </label>
          </fieldset>
        </div>
      )}

      {hostsTournament && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground-secondary">
              {t('organizer.newEvent.licesNames')}
            </p>
            <button
              type="button"
              onClick={() => dispatch({ type: 'ADD_LICE' })}
              disabled={state.liceNames.length >= 12}
              className="text-xs font-semibold text-accent hover:text-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('organizer.newEvent.liceAdd')}
            </button>
          </div>
          {state.liceNames.length === 0 ? (
            <p className="text-xs text-muted">{t('organizer.newEvent.licesEmptyHint')}</p>
          ) : (
            state.liceNames.map((name, index) => (
              <div key={index} className="flex items-center gap-2">
                <span className="w-6 text-right text-xs text-muted">{index + 1}.</span>
                <input
                  type="text"
                  value={name}
                  aria-label={t('organizer.newEvent.liceName', { number: index + 1 })}
                  onChange={(event) =>
                    dispatch({ type: 'SET_LICE_NAME', index, value: event.target.value })
                  }
                  className="flex-1 rounded-lg border border-border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                />
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'REMOVE_LICE', index })}
                  aria-label={t('organizer.newEvent.liceRemove')}
                  className="h-8 w-8 rounded-lg border border-border text-xs text-muted hover:bg-background"
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {hostsWorkshop && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground-secondary">
              {t('organizer.newEvent.areaNames')}
            </p>
            <button
              type="button"
              onClick={() => dispatch({ type: 'ADD_AREA' })}
              disabled={state.areaNames.length >= 12}
              className="text-xs font-semibold text-accent hover:text-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('organizer.newEvent.areaAdd')}
            </button>
          </div>
          <p className="text-xs text-muted">{t('organizer.newEvent.areaHint')}</p>
          {state.areaNames.map((name, index) => (
            <div key={index} className="flex items-center gap-2">
              <span className="w-6 text-right text-xs text-muted">{index + 1}.</span>
              <input
                type="text"
                value={name}
                aria-label={t('organizer.newEvent.areaName', { number: index + 1 })}
                onChange={(event) =>
                  dispatch({ type: 'SET_AREA_NAME', index, value: event.target.value })
                }
                className="flex-1 rounded-lg border border-border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <button
                type="button"
                onClick={() => dispatch({ type: 'REMOVE_AREA', index })}
                aria-label={t('organizer.newEvent.areaRemove')}
                className="h-8 w-8 rounded-lg border border-border text-xs text-muted hover:bg-background"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
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
        <label
          htmlFor="wizard-logo-url"
          className="mb-1 block text-sm font-medium text-foreground-secondary"
        >
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
          className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <div className="mt-3 flex flex-col gap-3">
          <input
            id="wizard-logo-file"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => onLogoChange(event.target.files?.[0] ?? null)}
            className="block w-full text-sm text-foreground-secondary file:mr-3 file:rounded-lg file:border-0 file:bg-strong file:px-3 file:py-2 file:text-sm file:font-semibold file:text-strong-foreground hover:file:bg-strong-hover"
          />
          <p className="text-xs text-muted">{t('organizer.newEvent.logoHelp')}</p>
          {logoPreviewUrl && (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logoPreviewUrl}
                alt={t('organizer.newEvent.logoPreviewAlt')}
                className="h-12 w-12 rounded bg-surface object-contain p-1"
              />
              <span className="text-xs text-muted">{t('organizer.newEvent.logoUpload')}</span>
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
  locale,
  logoPreviewUrl,
  catalogue,
}: {
  state: WizardState;
  t: Translator;
  locale: string;
  logoPreviewUrl: string | null;
  catalogue: CatalogueVenue[];
}) {
  const pickedVenue =
    state.venueMode === 'existing'
      ? (catalogue.find((v) => v.id === state.selectedVenueId) ?? null)
      : null;
  const venueLabel =
    state.venueMode === 'existing' ? (pickedVenue?.name ?? '') : state.newVenueName;
  const venueAddress =
    state.venueMode === 'existing' ? (pickedVenue?.address ?? '') : state.newVenueAddress;
  const venueHostsTournament =
    state.venueMode === 'existing'
      ? (pickedVenue?.hosts_tournament ?? false)
      : state.newVenueHostsTournament;
  const venueHostsWorkshop =
    state.venueMode === 'existing'
      ? (pickedVenue?.hosts_workshop ?? false)
      : state.newVenueHostsWorkshop;

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="rounded-xl border border-border bg-background p-4">
        <p className="mb-2 text-xs uppercase tracking-wide text-muted">
          {t('organizer.newEvent.reviewEvent')}
        </p>
        <p className="font-semibold text-foreground">{state.name}</p>
        <p className="mt-0.5 font-mono text-xs text-muted">/e/{state.slug}</p>
        <p className="mt-1 text-muted">
          {state.startDate} - {state.endDate}
          {(() => {
            const countryName = formatCountryName(state.country, locale);
            const place = [state.city, countryName].filter(Boolean).join(', ');
            return place ? ` - ${place}` : '';
          })()}
        </p>
      </div>

      <div className="rounded-xl border border-border bg-background p-4">
        <p className="mb-2 text-xs uppercase tracking-wide text-muted">
          {state.venueMode === 'existing'
            ? t('organizer.newEvent.reviewVenueExisting')
            : t('organizer.newEvent.reviewVenueNew')}
        </p>
        <p className="font-semibold text-foreground">{venueLabel}</p>
        {venueAddress && <p className="mt-0.5 text-xs text-muted">{venueAddress}</p>}
        <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
          {venueHostsTournament && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 font-semibold text-blue-700">
              {t('organizer.venues.tournamentBadge')}
            </span>
          )}
          {venueHostsWorkshop && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 font-semibold text-green-700">
              {t('organizer.venues.workshopBadge')}
            </span>
          )}
        </div>
        {venueHostsTournament && state.liceNames.length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-xs uppercase tracking-wide text-muted">
              {t('organizer.newEvent.reviewLices', { count: state.liceNames.length })}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {state.liceNames.map((name, index) => (
                <span
                  key={index}
                  className="rounded border border-border bg-surface px-2 py-0.5 text-xs"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        )}
        {venueHostsWorkshop && state.areaNames.length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-xs uppercase tracking-wide text-muted">
              {t('organizer.newEvent.reviewAreas', { count: state.areaNames.length })}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {state.areaNames.map((name, index) => (
                <span
                  key={index}
                  className="rounded border border-border bg-surface px-2 py-0.5 text-xs"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {logoPreviewUrl && (
        <div className="rounded-xl border border-border bg-background p-4">
          <p className="mb-2 text-xs uppercase tracking-wide text-muted">
            {t('organizer.newEvent.reviewTheme')}
          </p>
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logoPreviewUrl}
              alt={t('organizer.newEvent.logoPreviewAlt')}
              className="h-10 w-10 rounded bg-surface object-contain"
            />
            <span className="text-xs text-muted">{t('organizer.newEvent.logoUpload')}</span>
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
  const { selectEvent, refetchEvents } = useOrganizerSelectedEvent();
  const apiUrl = getPublicApiUrl();
  const { locale, t } = useI18n();

  const [state, dispatch] = useReducer(reducer, INITIAL);
  const [stepError, setStepError] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const logoPreviewRef = useRef<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [catalogue, setCatalogue] = useState<CatalogueVenue[]>([]);
  const [catalogueLoading, setCatalogueLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // Silent on a refusal, as before: `handleCreate` re-resolves the org
        // defensively and reports there, where the operator is actually acting.
        const orgRes = await apiRequest<{ id: string }>(
          apiUrl,
          `/api/v1/organizations/slug/${encodeURIComponent(slug)}`,
        );
        if (!orgRes.ok || cancelled) return;
        setOrgId(orgRes.data.id);
        const venuesRes = await apiRequest<CatalogueVenue[]>(
          apiUrl,
          `/api/v1/organizations/${orgRes.data.id}/venues`,
        );
        if (!venuesRes.ok || cancelled) return;
        setCatalogue(venuesRes.data);
        // If the org has no venues yet, force the operator into create-new
        // mode so the empty-state banner makes sense.
        if (venuesRes.data.length === 0) {
          dispatch({ type: 'SET_VENUE_MODE', mode: 'new' });
        }
      } finally {
        if (!cancelled) setCatalogueLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiUrl, slug]);
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
    if (state.step === 2) err = validateStep2(state, catalogue, t);
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

    // One place the wizard's three fatal refusals report from. `null` is the
    // abort `failureMessage` answers with, and none of these pass a signal, so
    // it falls back to the wizard's own generic sentence rather than clearing
    // the banner.
    const fail = (message: string | null) =>
      dispatch({
        type: 'SUBMIT_ERROR',
        error: message ?? t('organizer.newEvent.validation.generic'),
      });

    try {
      // Reuse the org id we loaded on mount; refetch defensively in case
      // the venues effect failed (network / 5xx) but the operator still
      // managed to fill the wizard.
      let resolvedOrgId = orgId;
      if (!resolvedOrgId) {
        const orgRes = await apiRequest<{ id: string }>(
          apiUrl,
          `/api/v1/organizations/slug/${encodeURIComponent(slug)}`,
        );
        if (!orgRes.ok) {
          fail(failureMessage(orgRes, t, t('organizer.newEvent.validation.organizationNotFound')));
          return;
        }
        resolvedOrgId = orgRes.data.id;
      }

      const eventRes = await apiRequest<{ id: string }>(
        apiUrl,
        `/api/v1/organizations/${resolvedOrgId}/events`,
        {
          method: 'POST',
          body: {
            slug: state.slug,
            name: state.name.trim(),
            startDate: state.startDate,
            endDate: state.endDate,
            city: state.city.trim() || null,
            country: state.country || null,
            eventKind: state.eventKind,
          },
        },
      );
      if (!eventRes.ok) {
        // A slug already taken, a date range the org refuses — the API names
        // which, and every one of them used to read "Could not create event."
        fail(failureMessage(eventRes, t, t('organizer.newEvent.validation.createFailed')));
        return;
      }
      const event = eventRes.data;

      // Materialise the venue. Mode 'new' creates a fresh venue in the
      // org catalogue; mode 'existing' simply reuses the picked id.
      let venueId: string | null = null;
      let venueHostsTournament = false;
      let venueHostsWorkshop = false;
      if (state.venueMode === 'existing' && state.selectedVenueId) {
        const picked = catalogue.find((v) => v.id === state.selectedVenueId);
        if (picked) {
          venueId = picked.id;
          venueHostsTournament = picked.hosts_tournament;
          venueHostsWorkshop = picked.hosts_workshop;
        }
      } else if (state.venueMode === 'new') {
        const venueRes = await apiRequest<{ id: string }>(
          apiUrl,
          `/api/v1/organizations/${resolvedOrgId}/venues`,
          {
            method: 'POST',
            body: {
              name: state.newVenueName.trim(),
              address: state.newVenueAddress.trim() || undefined,
              hostsTournament: state.newVenueHostsTournament,
              hostsWorkshop: state.newVenueHostsWorkshop,
            },
          },
        );
        if (!venueRes.ok) {
          fail(failureMessage(venueRes, t, t('organizer.newEvent.validation.venueCreateFailed')));
          return;
        }
        venueId = venueRes.data.id;
        venueHostsTournament = state.newVenueHostsTournament;
        venueHostsWorkshop = state.newVenueHostsWorkshop;
      }

      // Lice rows linked to the venue (tournament-capable venues only).
      if (venueHostsTournament && state.liceNames.length > 0) {
        // Follow-up writes on an event that already exists. They still
        // discard their refusals, unchanged: the operator lands on the event,
        // where the lices and areas are listed, so a dropped one is visible.
        await Promise.all(
          state.liceNames.map((name, index) =>
            apiRequest(apiUrl, `/api/v1/events/${event.id}/lices`, {
              method: 'POST',
              body: { name: name.trim(), sortOrder: index, venueId: venueId ?? undefined },
            }),
          ),
        );
      }

      // Areas attached to the venue (workshop-capable + only when the
      // operator defined named areas; a single implicit area = no rows).
      if (venueHostsWorkshop && venueId && state.areaNames.length > 0) {
        await Promise.all(
          state.areaNames.map((name, index) =>
            apiRequest(apiUrl, `/api/v1/venues/${venueId}/areas`, {
              method: 'POST',
              body: { name: name.trim(), sortOrder: index },
            }),
          ),
        );
      }

      const pastedLogoUrl = state.logoUrl.trim() || null;
      if (logoFile) {
        // Canonical events-level endpoint: writes to storage AND
        // events.logo_url. (Theme retired its own logo column in
        // migration 0084.)
        const formData = new FormData();
        formData.append('file', logoFile);
        const logoRes = await apiRequest(apiUrl, `/api/v1/events/${event.id}/logo`, {
          method: 'POST',
          body: formData,
        });
        if (!logoRes.ok) {
          selectEvent(event.id);
          await refetchEvents();
          router.push(`/org/${slug}/events/${event.id}/theme?logoUpload=failed`);
          return;
        }
      } else if (pastedLogoUrl) {
        // Operator pasted a URL instead of uploading a file —
        // mirror it onto events.logo_url via the theme upsert
        // (which now routes logoUrl to the events column).
        await apiRequest(apiUrl, `/api/v1/events/${event.id}/theme`, {
          method: 'POST',
          body: { logoUrl: pastedLogoUrl },
        });
      }

      // Per-event color overrides retired in migration 0086 — the
      // primary color used to write to themes.primary_color. No-op
      // here now; the Branding page handles logo + hero post-create.

      selectEvent(event.id);
      // Refresh the picker so the newly-created event shows up in
      // the sidebar dropdown without a hard page refresh. Awaiting
      // here so the picker is populated by the time router.push
      // resolves on the destination page.
      await refetchEvents();
      router.push(`/org/${slug}/events/${event.id}`);
    } catch (err) {
      // `apiRequest` does not throw, but two things inside this function still
      // can: `refetchEvents` (the organizer event-picker context) and the
      // router push. Neither has a reason worth quoting, so the wizard's own
      // generic sentence is the honest one.
      fail(err instanceof Error ? err.message : null);
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <div className="mb-6 flex items-center gap-3">
        <Button type="button" variant="back" size="sm" onClick={() => router.push(`/org/${slug}`)}>
          {t('organizer.newEvent.backToOrg', { slug })}
        </Button>
        <span className="text-muted">/</span>
        <h1 className="font-display font-bold text-2xl sm:text-3xl">
          {t('organizer.newEvent.title')}
        </h1>
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
                    ? 'bg-accent text-accent-foreground'
                    : done
                      ? 'bg-success text-success-foreground'
                      : 'bg-border text-muted',
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
                  active ? 'font-semibold text-foreground' : 'text-muted',
                ].join(' ')}
              >
                {label}
              </span>
              {index < stepLabels.length - 1 && (
                <div aria-hidden="true" className="mx-1 h-px w-6 bg-border" />
              )}
            </li>
          );
        })}
      </ol>

      <div className="mb-6">
        {state.step === 1 && <Step1 state={state} dispatch={dispatch} t={t} locale={locale} />}
        {state.step === 2 && (
          <Step2
            state={state}
            dispatch={dispatch}
            t={t}
            catalogue={catalogue}
            catalogueLoading={catalogueLoading}
          />
        )}
        {state.step === 3 && (
          <Step3
            state={state}
            dispatch={dispatch}
            t={t}
            logoPreviewUrl={logoPreviewUrl}
            onLogoChange={handleLogoChange}
          />
        )}
        {state.step === 4 && (
          <Step4
            state={state}
            t={t}
            locale={locale}
            logoPreviewUrl={logoPreviewUrl}
            catalogue={catalogue}
          />
        )}
      </div>

      {(stepError ?? state.error) && (
        <p className="mb-4 text-sm text-danger" role="alert">
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
          <Button type="button" variant="primary" data-testid="wizard-next" onClick={handleNext}>
            {t('organizer.newEvent.next')}
          </Button>
        ) : (
          <Button
            type="button"
            variant="primary"
            data-testid="wizard-create"
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
