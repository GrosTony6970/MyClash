/**
 * `{ [key]: text }` when the text changed since the panel opened, trimmed and a blank one as
 * null; else `{}`. The one rule of a text two people write (the instructor here, the organiser
 * in the Workshop's form, rulings 557, 558): a box not touched is not sent, so it cannot wipe what
 * the other wrote meanwhile. Both changed: the last save wins.
 */
export function changedText<K extends string>(
  key: K,
  draft: Record<K, string>,
  loaded: Record<K, string>,
): Partial<Record<K, string | null>> {
  const now = draft[key].trim() || null;
  return now === (loaded[key].trim() || null)
    ? {}
    : ({ [key]: now } as Partial<Record<K, string | null>>);
}
