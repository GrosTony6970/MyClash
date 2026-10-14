import { DEFAULT_EVENT_KIND, type EventKind } from '@myclash/types';

export interface CatalogueVenue {
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

export type VenueMode = 'existing' | 'new';

export interface WizardState {
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

export const INITIAL: WizardState = {
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

/**
 * The organiser typed or picked something the wizard would lose on leaving (O12, operator
 * 2026-10-14): a field that differs from the empty form, or a logo picked. The step, a
 * submission running and its error are no input.
 */
export function wizardDirty(state: WizardState, logoPicked: boolean): boolean {
  if (logoPicked) return true;
  const input = (s: WizardState) => ({ ...s, step: 1, submitting: false, error: null });
  return JSON.stringify(input(state)) !== JSON.stringify(input(INITIAL));
}
