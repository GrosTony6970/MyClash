/** Where an error page's "way home" leads, and the key of what it says. */
export interface ErrorHome {
  href: string;
  labelKey: string;
}

/**
 * The way home from a page that failed (quick win F14): the Event's home for a
 * page of an Event, the public list of Events for any other page. The Event's
 * own home leads to the list too: a link to the page that just failed is no
 * way out.
 */
export function errorHome(
  eventSlug: string | null | undefined,
  path: string | null | undefined,
): ErrorHome {
  const eventHome = eventSlug ? `/e/${eventSlug}/home` : null;
  if (!eventHome || path === eventHome || path === `/e/${eventSlug}`) {
    return { href: '/', labelKey: 'publicApp.login.backToEvents' };
  }
  return { href: eventHome, labelKey: 'publicApp.eventHome.backToHome' };
}
