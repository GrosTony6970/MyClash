/**
 * The PATCH a rules screen sends: only the leaves the organiser changed (operator rulings 43, 46).
 * The server writes what is sent on top of what the Tournament stores, so a field the organiser
 * did not touch is never sent, and an untouched Save sends nothing at all. The ONE owner, for the
 * settings tabs and the wizard steps.
 *
 * `saved` is the body of the form as last read or last saved, `edited` the body of the form now.
 * A leaf of `edited` that differs from `saved` is sent; a list is sent whole when it differs (the
 * server replaces a list whole); a key absent from `edited` is never a change. A null is a value:
 * the forfeit rule's Off is sent as one. Answers null when nothing differs.
 */
type Body = Record<string, unknown>;

const isObject = (value: unknown): value is Body =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function patchOf(saved: Body, edited: Body): Body | null {
  const patch: Body = {};
  for (const [key, value] of Object.entries(edited)) {
    const before = saved[key];
    if (isObject(value) && isObject(before)) {
      const inner = patchOf(before, value);
      if (inner) patch[key] = inner;
    } else if (JSON.stringify(value) !== JSON.stringify(before)) {
      patch[key] = value;
    }
  }
  return Object.keys(patch).length ? patch : null;
}
