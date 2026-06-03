/**
 * Pure helpers for the workshop create form's "slug auto-tracks name"
 * binding. Pulled out of the component so the lock-after-one-letter
 * regression has a precise vitest pin.
 */

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Decides the slug a name-keystroke should produce on the workshop
 * create form.
 *
 * Auto-tracks the name as long as the current slug still matches
 * what `slugify(prevName)` would have produced. The moment the
 * operator types something in the slug field that diverges from
 * that auto-form, this function returns the operator's slug
 * verbatim so subsequent name keystrokes don't overwrite it.
 *
 * Replaces the `f.slug || slugify(newName)` shortcut that froze
 * the slug at the first character — that test treated any non-empty
 * slug as "operator customized", but the auto-generated first
 * letter is itself non-empty, so every subsequent keystroke was
 * permanently ignored.
 */
export function nextSlugFromName(prevSlug: string, prevName: string, newName: string): string {
  if (!prevSlug || prevSlug === slugify(prevName)) {
    return slugify(newName);
  }
  return prevSlug;
}
