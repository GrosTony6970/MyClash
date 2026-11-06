import { photosShown } from '@myclash/types';
import type { MyEvent } from './types';

/**
 * The tabs of one Event in her personal space: the ONE list the hub's strip and the sidebar's
 * links both draw (`EventHubChrome`, `MyEventsNav`).
 */
export type HubTab = 'overview' | 'schedule' | 'workshops' | 'photos';

/** Each tab's name, as an i18n key: a new tab without one does not compile. */
export const HUB_TAB_LABEL: Record<HubTab, string> = {
  overview: 'publicApp.me.hub.tabOverview',
  schedule: 'publicApp.me.hub.tabSchedule',
  workshops: 'publicApp.me.hub.tabWorkshops',
  photos: 'publicApp.me.hub.tabPhotos',
};

/**
 * The Photos tab shows when the Event shows photos, or she has sent photos there from her personal
 * space (design, "Where it shows up" item 5): with photos Off she can still delete hers.
 */
export function photosTabShown(myEvent: MyEvent): boolean {
  return photosShown(myEvent.event.photoMode) || myEvent.hasMyPhotos;
}

export function hubTabs(myEvent: MyEvent): HubTab[] {
  const tabs: HubTab[] = ['overview', 'schedule', 'workshops'];
  return photosTabShown(myEvent) ? [...tabs, 'photos'] : tabs;
}

/** Overview is the Event's own address (the index route); every other tab sits below it. */
export function hubTabPath(eventSlug: string, tab: HubTab): string {
  const base = `/me/events/${eventSlug}`;
  return tab === 'overview' ? base : `${base}/${tab}`;
}
