/**
 * The one door that writes query words into an Event page's address: its Tournament
 * (`useTournamentChoice`) and a list's filters (`useAddressFilters`).
 *
 * The race: a `router.replace` that changes the query of this server-rendered app is a round
 * trip, and the address moves only when it commits. Each writer built on the address as it
 * was, so a Tournament switched while a filter write was out wrote the old query back, and
 * the filter left the address (a reload then lost it). Each write is now kept here until the
 * address shows it, and the next write builds on the address with the writes still out. A
 * write meant for another page is forgotten.
 */
interface Out {
  path: string;
  value: string | null;
}

const out = new Map<string, Out>();

function shows(url: URL, key: string, value: string | null): boolean {
  return url.searchParams.get(key) === value;
}

/** Forgets each write the address shows now, and each meant for another page. */
export function forgetLanded(): void {
  const url = new URL(window.location.href);
  for (const [key, write] of out) {
    if (write.path !== url.pathname || shows(url, key, write.value)) out.delete(key);
  }
}

/** `params`: each word to set, or null to take it out of the address. */
export function writeAddress(
  replace: (href: string) => void,
  params: Readonly<Record<string, string | null>>,
): void {
  forgetLanded();
  const url = new URL(window.location.href);
  const words = new Map([...out].map(([key, write]) => [key, write.value]));
  for (const [key, value] of Object.entries(params)) {
    words.set(key, value);
    out.set(key, { path: url.pathname, value });
  }
  for (const [key, value] of words) {
    if (value === null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  replace(`${url.pathname}${url.search}${url.hash}`);
}
