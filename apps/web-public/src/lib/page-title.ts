/**
 * What a browser tab reads, for the whole public site (quick wins F15, F16).
 * ONE rule: the page's own words, then where it is. Inside an Event that is
 * the Event's name ("Longsword Open · FAL 2026"); anywhere else, the site's
 * ("Leagues · MyClash").
 *
 * A PAGE gives its own words only. The two layouts below add the rest, so a
 * page that writes the site's name itself gets it twice: three pages did, and
 * read "Longsword Open · MyClash — MyClash".
 */
/** The rule of the root layout: every page outside an Event. `%s` is the page's own words. */
export function siteTitles(siteName: string): { template: string; default: string } {
  return { template: `%s · ${siteName}`, default: siteName };
}

/**
 * The rule of the Event's layout. A tab is narrow, and the Event's name is
 * what tells two tabs apart: the site's name is left out here.
 *
 * `absolute`, not `default`: Next puts the ROOT's template around a nested
 * `default`, so a page with no words of its own (a TV screen) read
 * "FAL 2026 · MyClash".
 */
export function eventTitles(eventName: string): { template: string; absolute: string } {
  return { template: `%s · ${eventName}`, absolute: eventName };
}

type Translate = (key: string, values?: Record<string, string>) => string;

/**
 * A bout's own words: its two fighters. A bout that still waits for a fighter,
 * or whose names could not be read, falls back to its number, then to "Match".
 */
export function boutTitle(
  bout: { redName: string; blueName: string; label: string | null | undefined },
  t: Translate,
): string {
  const red = bout.redName.trim();
  const blue = bout.blueName.trim();
  if (red && blue) return t('publicApp.titles.bout', { red, blue });
  return bout.label
    ? t('publicApp.titles.boutNumbered', { label: bout.label })
    : t('publicApp.titles.boutPlain');
}
